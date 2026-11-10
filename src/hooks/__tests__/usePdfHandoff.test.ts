// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadAnnoDoc } from '@/lib/annotation'
import { resetTestLocale, setTestLocale } from '@/test-utils/i18n-mock'
import { usePdfHandoff } from '../usePdfHandoff'

// supabase 模块加载即校验环境变量 ⇒ 必须桩掉（仓里的惯例）
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

vi.mock('@tarojs/taro', () => ({
  default: {
    getDeviceInfo: () => ({ platform: 'ios' }),
    getFileSystemManager: () => ({}),
    showToast: vi.fn(),
    setClipboardData: vi.fn().mockResolvedValue({}),
    showModal: vi.fn().mockResolvedValue({}),
  },
}))

// ⚠️ `t` 必须是**稳定引用**：进了依赖数组就会无限重渲染（本仓踩过，见 vitest-hook-mock 那条）
vi.mock('@/i18n', async () => {
  const { createI18nMock } = await import('@/test-utils/i18n-mock')
  return createI18nMock()
})

const {
  ensureSavedPdf,
  composeAnnotatedPdf,
  composeSharedPdf,
  reportClientError,
  handOffPdf,
  syncAnnotationFile,
  order,
} = vi.hoisted(() => ({
  ensureSavedPdf: vi.fn(),
  composeAnnotatedPdf: vi.fn(),
  composeSharedPdf: vi.fn(),
  reportClientError: vi.fn(),
  handOffPdf: vi.fn(),
  syncAnnotationFile: vi.fn(),
  order: [] as string[],
}))

vi.mock('@/lib/pdf-save', () => ({
  ensureSavedPdf,
  userDataRoot: () => 'wxfile://usr',
}))
vi.mock('@/lib/annotated-pdf', async () => {
  const actual = await vi.importActual<typeof import('@/lib/annotated-pdf')>('@/lib/annotated-pdf')
  return { ...actual, composeAnnotatedPdf, composeSharedPdf }
})
vi.mock('@/lib/annotation-sync-runner', () => ({ syncAnnotationFile }))
vi.mock('@/lib/pdf-handoff', () => ({
  handoffKindsFor: () => ['favorites', 'chat', 'app'],
  handOffPdf,
}))
vi.mock('@/lib/error-report', () => ({
  describeError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  reportClientError,
}))

// 「这一册有没有笔迹」由 `open()` 读一次（判据是 `docHasInk`）。这里只桩掉**读盘**那一步，
// 判据本身用真的 —— 于是「有没有笔迹」在用例里是一行 mockReturnValue 的事。
vi.mock('@/lib/annotation', async () => {
  const actual = await vi.importActual<typeof import('@/lib/annotation')>('@/lib/annotation')
  return { ...actual, loadAnnoDoc: vi.fn() }
})

const meta = (fileId = 'f1') => ({
  fileId,
  url: () => 'https://x.supabase.co/storage/v1/object/public/sheet-music/a.pdf',
  title: '红旗颂',
  section: '弦乐',
  fileName: '总谱.pdf',
  expectedBytes: 1000,
})

/** `ensureSavedPdf` 的入参（它就是「拿哪一份去交付」的唯一判据） */
const savedCall = (i = 0) => ensureSavedPdf.mock.calls[i][0] as Record<string, unknown>

const taroMock = Taro as unknown as {
  setClipboardData: ReturnType<typeof vi.fn>
  showModal: ReturnType<typeof vi.fn>
  showToast: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  resetTestLocale()
  taroMock.setClipboardData.mockClear()
  taroMock.showModal.mockClear()
  taroMock.showToast.mockClear()
  // 默认「这一册有笔迹」——没有笔迹时开关被禁用（那一组用例自己改这个桩）
  vi.mocked(loadAnnoDoc)
    .mockReset()
    .mockReturnValue({
      '1': [
        {
          color: '#e5484d',
          width: 0.004,
          points: [
            [0.1, 0.1],
            [0.2, 0.2],
          ] as [number, number][],
        },
      ],
    })
  ensureSavedPdf.mockReset().mockImplementation(async (opts: { fileId: string }) => ({
    path: `wxfile://usr/${opts.fileId}.pdf`,
    name: `${opts.fileId}.pdf`,
    reused: false,
  }))
  composeAnnotatedPdf.mockReset().mockResolvedValue({
    url: 'https://x.supabase.co/storage/v1/object/sign/anno.pdf?token=t',
    bytes: 4321,
    annotatedPages: 2,
    drawnStrokes: 7,
  })
  reportClientError.mockReset()
  handOffPdf.mockReset().mockResolvedValue(undefined)
  order.length = 0
  syncAnnotationFile.mockReset().mockImplementation(async () => {
    order.push('sync')
    return { status: 'ok', pushed: 0, adopted: 0, conflicts: 0 }
  })
  composeAnnotatedPdf.mockImplementation(async () => {
    order.push('compose')
    return {
      url: 'https://x.supabase.co/storage/v1/object/sign/anno.pdf?token=t',
      bytes: 4321,
      annotatedPages: 2,
      drawnStrokes: 7,
    }
  })
  composeSharedPdf.mockReset().mockResolvedValue({
    url: 'https://x.supabase.co/storage/v1/object/sign/shared.pdf?token=s',
    bytes: 8765,
    annotatedPages: 3,
    drawnStrokes: 9,
  })
})

afterEach(() => {
  cleanup()
})

describe('usePdfHandoff：是否带有批注', () => {
  it('这一册没有笔迹：固定为「否」且拨不动（拨了不发起合成）', async () => {
    vi.mocked(loadAnnoDoc).mockReturnValue({})
    const { result } = renderHook(() => usePdfHandoff('u1'))
    act(() => result.current.open(meta()))
    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(result.current.hasAnno).toBe(false)
    expect(result.current.withAnno).toBe(false)
    // 拨它：状态不动，也不去云端合成（不然只会换来一句「这份谱还没有批注」）
    act(() => result.current.toggleAnno(true))
    expect(result.current.withAnno).toBe(false)
    expect(composeAnnotatedPdf).not.toHaveBeenCalled()
  })

  it('共享谱：带批注走 compose-shared-pdf，先 flush 共享层，缓存键与个人产物分开（P6d）', async () => {
    const beforeCompose = vi.fn().mockResolvedValue(undefined)
    const sharedMeta = {
      ...meta(),
      composeKind: 'shared' as const,
      hasInk: () => true,
      beforeCompose,
    }
    const { result } = renderHook(() => usePdfHandoff('u1'))
    act(() => result.current.open(sharedMeta))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.hasAnno).toBe(true)

    act(() => result.current.toggleAnno(true))
    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(beforeCompose).toHaveBeenCalledTimes(1)
    expect(syncAnnotationFile).not.toHaveBeenCalled()
    expect(composeSharedPdf).toHaveBeenCalledWith('f1')
    expect(composeAnnotatedPdf).not.toHaveBeenCalled()
    const last = savedCall(ensureSavedPdf.mock.calls.length - 1)
    expect(last.url).toContain('token=s')
    expect(last.fileId).toBe('f1#shared-anno')
    expect(last.expectedBytes).toBe(8765)
  })

  it('默认不带批注：不调云端合成，直接下原件', async () => {
    const { result } = renderHook(() => usePdfHandoff('u1'))
    act(() => result.current.open(meta()))

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(composeAnnotatedPdf).not.toHaveBeenCalled()
    expect(savedCall().fileId).toBe('f1')
    expect(savedCall().url).toContain('/public/')
    expect(savedCall().force).toBe(false) // 原件那份不需要重下
  })

  it('拨到「是」：调合成、用签名 URL 与产物字节数下载，文件名带后缀', async () => {
    const { result } = renderHook(() => usePdfHandoff('u1'))
    act(() => result.current.open(meta()))
    await waitFor(() => expect(result.current.ready).toBe(true))

    act(() => result.current.toggleAnno(true))
    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(composeAnnotatedPdf).toHaveBeenCalledWith('f1')
    const last = savedCall(ensureSavedPdf.mock.calls.length - 1)
    expect(last.url).toContain('token=t')
    // 字节数取服务端给的那个确切值，分片下载才有依据
    expect(last.expectedBytes).toBe(4321)
    expect(String(last.fileName)).toContain('带批注')
    // ⚠️ 传给 ensureSavedPdf 的名字里**不能带 `.pdf`**：库里的 file_name 自带扩展名，
    // 后缀要加在它之前；否则 displayPdfName 只剥末尾那个 ⇒ `总谱.pdf（带批注）.pdf`（真机报过）
    expect(String(last.fileName)).toBe('总谱（带批注）')
    // ⚠️ 必须 force：本地那个路径是固定的，不强制的话**新合成的那份根本不会被下载**，
    // 交出去的是上一次的旧内容（用户又多画了几笔也照样是旧的）
    expect(last.force).toBe(true)
  })

  it('英文环境：带批注的文件名用英文后缀，且同样不夹带 .pdf', async () => {
    setTestLocale('en')
    const { result } = renderHook(() => usePdfHandoff('u1'))
    act(() => result.current.open(meta()))
    await waitFor(() => expect(result.current.ready).toBe(true))

    act(() => result.current.toggleAnno(true))
    await waitFor(() => expect(result.current.ready).toBe(true))

    const last = savedCall(ensureSavedPdf.mock.calls.length - 1)
    expect(String(last.fileName)).toBe('总谱 (annotated)')
    expect(String(last.fileName)).not.toContain('.pdf')
  })

  it('⚠️ 合成之前必须**先同步**：函数读的是服务端那份，本地没推上去就会少画几笔', async () => {
    const { result } = renderHook(() => usePdfHandoff('u1'))
    // ⚠️ 顺序必须「先 open 再拨」：`hasAnno`（这一册有没有笔迹）是在 open 那一刻定的，
    // 而没笔迹时开关拨不动 —— 这也正是真机上的唯一顺序（面板不开，哪来的开关）
    act(() => result.current.open(meta()))
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => result.current.toggleAnno(true))

    await waitFor(() => expect(composeAnnotatedPdf).toHaveBeenCalled())
    expect(syncAnnotationFile).toHaveBeenCalledWith('f1')
    expect(order).toEqual(['sync', 'compose']) // 顺序也要对，不能只是都调了
  })

  it('带批注那条把三段耗时报上来（真机没有 Network 面板，只能自己报）', async () => {
    const { result } = renderHook(() => usePdfHandoff('u1'))
    act(() => result.current.open(meta()))
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => result.current.toggleAnno(true))
    await waitFor(() => expect(composeAnnotatedPdf).toHaveBeenCalled())

    await waitFor(() => expect(result.current.ready).toBe(true))
    const logged = reportClientError.mock.calls
      .map((c) => c[0] as { event: string; detail: Record<string, number> })
      .find((r) => r.event === 'score_reader_annotated_prepare')
    expect(logged).toBeTruthy()
    // 三段都在，且是数字（0 也可能是对的——测试里是瞬时的）
    for (const k of ['totalMs', 'syncMs', 'composeMs', 'fetchMs']) {
      expect(typeof logged?.detail[k]).toBe('number')
    }
  })

  it('不带批注那条**不**去同步（没必要多一次拉取）', async () => {
    const { result } = renderHook(() => usePdfHandoff('u1'))
    act(() => result.current.open(meta()))

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(syncAnnotationFile).not.toHaveBeenCalled()
  })

  it('⚠️ 带批注那份走**另一个记账键**：先存了原件，再拨开关不能复用原件', async () => {
    const { result } = renderHook(() => usePdfHandoff('u1'))
    act(() => result.current.open(meta()))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(savedCall().fileId).toBe('f1')

    act(() => result.current.toggleAnno(true))
    await waitFor(() => expect(result.current.ready).toBe(true))

    const last = savedCall(ensureSavedPdf.mock.calls.length - 1)
    expect(last.fileId).toBe('f1#anno')
  })

  it('拨回「否」：回到原件那一份（键也回原 id）', async () => {
    const { result } = renderHook(() => usePdfHandoff('u1'))
    act(() => result.current.open(meta()))
    act(() => result.current.toggleAnno(true))
    await waitFor(() => expect(result.current.ready).toBe(true))

    act(() => result.current.toggleAnno(false))
    await waitFor(() => expect(result.current.ready).toBe(true))

    const last = savedCall(ensureSavedPdf.mock.calls.length - 1)
    expect(last.fileId).toBe('f1')
    expect(composeAnnotatedPdf).toHaveBeenCalledTimes(1) // 回程不该再合成一次
  })

  it('选择变了之后，旧那份**不算就绪**（不能把上一份交给用户）', async () => {
    let resolveCompose: (v: unknown) => void = () => {}
    composeAnnotatedPdf.mockReturnValue(new Promise((r) => (resolveCompose = r)))
    const { result } = renderHook(() => usePdfHandoff('u1'))
    act(() => result.current.open(meta()))
    await waitFor(() => expect(result.current.ready).toBe(true))

    act(() => result.current.toggleAnno(true))
    // 合成还没回来：出口必须不可点（否则交付的是**原件**，而用户要的是带批注的）
    expect(result.current.ready).toBe(false)

    await act(async () => {
      resolveCompose({
        url: 'https://x/anno.pdf?token=t',
        bytes: 1,
        annotatedPages: 1,
        drawnStrokes: 1,
      })
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
  })

  it('⚠️ 慢的那次后回来也不能翻盘：带批注还在合成时拨回「否」，交付的必须是原件', async () => {
    const { AnnotatedPdfError } =
      await vi.importActual<typeof import('@/lib/annotated-pdf')>('@/lib/annotated-pdf')
    void AnnotatedPdfError
    let resolveCompose: (v: unknown) => void = () => {}
    composeAnnotatedPdf.mockReturnValue(new Promise((r) => (resolveCompose = r)))

    const { result } = renderHook(() => usePdfHandoff('u1'))
    act(() => result.current.open(meta()))
    act(() => result.current.toggleAnno(true)) // 合成挂起
    act(() => result.current.toggleAnno(false)) // 用户改主意，原件那条很快回来
    await waitFor(() => expect(result.current.ready).toBe(true))

    // 挂起的那次合成此刻才回来——它已经作废，不许把已经备好的原件顶掉
    await act(async () => {
      resolveCompose({
        url: 'https://x/anno.pdf?token=t',
        bytes: 1,
        annotatedPages: 1,
        drawnStrokes: 1,
      })
    })

    expect(result.current.ready).toBe(true)

    // 交付出去的是**哪一份**才是判据：被作废的那次合成也走到了下载（白做一次，无害），
    // 所以不能拿「最后一次调用」当证据——要看真正交出去的文件
    act(() => result.current.pick('favorites'))
    await waitFor(() => expect(handOffPdf).toHaveBeenCalled())
    const handed = handOffPdf.mock.calls[0][1] as { path: string }
    expect(handed.path).toContain('/f1.pdf')
    expect(handed.path).not.toContain('anno')
  })

  it('备文件期间 preparing 为真（面板据此禁用开关），结束后放下', async () => {
    let resolveSaved: (v: unknown) => void = () => {}
    ensureSavedPdf.mockReturnValue(new Promise((r) => (resolveSaved = r)))

    const { result } = renderHook(() => usePdfHandoff('u1'))
    expect(result.current.preparing).toBe(false)

    act(() => result.current.open(meta()))
    await waitFor(() => expect(result.current.preparing).toBe(true))

    await act(async () => {
      resolveSaved({ path: 'wxfile://usr/f1.pdf', name: 'f1.pdf', reused: false })
    })
    await waitFor(() => expect(result.current.preparing).toBe(false))
  })

  it('备文件失败也要放下 preparing（否则开关永久卡死，改不回原件）', async () => {
    ensureSavedPdf.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => usePdfHandoff('u1'))
    act(() => result.current.open(meta()))

    await waitFor(() => expect(reportClientError).toHaveBeenCalled())
    expect(result.current.preparing).toBe(false)
  })

  it('这份谱没有批注：给一句人话、**不当失败上报**（那是预期内的一种）', async () => {
    const { AnnotatedPdfError } =
      await vi.importActual<typeof import('@/lib/annotated-pdf')>('@/lib/annotated-pdf')
    composeAnnotatedPdf.mockRejectedValue(new AnnotatedPdfError('no annotations', 'no annotations'))

    const { result } = renderHook(() => usePdfHandoff('u1'))
    // 先打开（open 才知道这一册有没有笔迹），再拨「带批注」才会真的去合成
    act(() => result.current.open(meta()))
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => result.current.toggleAnno(true))

    await waitFor(() => expect(taroMock.showToast).toHaveBeenCalled())
    expect(reportClientError).not.toHaveBeenCalled()
  })

  it('合成失败（别的错因）：上报，且出口始终不可点', async () => {
    composeAnnotatedPdf.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => usePdfHandoff('u1'))
    act(() => result.current.open(meta()))
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => result.current.toggleAnno(true))

    await waitFor(() => expect(reportClientError).toHaveBeenCalled())
    expect(result.current.ready).toBe(false)
  })
})

describe('usePdfHandoff：复制下载链接', () => {
  it('原件：打开面板即可复制，不需要等本地文件备好', async () => {
    let resolveSaved: (v: unknown) => void = () => {}
    ensureSavedPdf.mockReturnValue(new Promise((r) => (resolveSaved = r)))

    const { result } = renderHook(() => usePdfHandoff('u1'))
    act(() => result.current.open(meta()))

    expect(result.current.copyable).toBe(true)
    act(() => result.current.copyLink())

    await waitFor(() =>
      expect(taroMock.setClipboardData).toHaveBeenCalledWith({ data: meta().url() })
    )
    expect(result.current.sheetOn).toBe(false)
    expect(taroMock.showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '链接已复制',
        content: expect.stringContaining('Safari'),
      })
    )

    await act(async () => {
      resolveSaved({ path: 'wxfile://usr/f1.pdf', name: 'f1.pdf', reused: false })
    })
  })

  it('带批注：合成完成后复制的是签名 URL，并说明 1 小时有效', async () => {
    const { result } = renderHook(() => usePdfHandoff('u1'))
    act(() => result.current.open(meta()))
    await waitFor(() => expect(result.current.ready).toBe(true))

    act(() => result.current.toggleAnno(true))
    await waitFor(() => expect(result.current.copyable).toBe(true))

    act(() => result.current.copyLink())
    await waitFor(() =>
      expect(taroMock.setClipboardData).toHaveBeenCalledWith({
        data: 'https://x.supabase.co/storage/v1/object/sign/anno.pdf?token=t',
      })
    )
    expect(taroMock.showModal).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('1 小时') })
    )
  })

  it('选择切换但新链接还没回来：不能把上一版的链接交出去', async () => {
    let resolveCompose: (v: unknown) => void = () => {}
    composeAnnotatedPdf.mockReturnValue(new Promise((r) => (resolveCompose = r)))

    const { result } = renderHook(() => usePdfHandoff('u1'))
    act(() => result.current.open(meta()))
    await waitFor(() => expect(result.current.ready).toBe(true))

    act(() => result.current.toggleAnno(true))
    expect(result.current.copyable).toBe(false)

    act(() => result.current.copyLink())
    expect(taroMock.setClipboardData).not.toHaveBeenCalled()
    expect(taroMock.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: '链接还没准备好，请稍候' })
    )

    await act(async () => {
      resolveCompose({
        url: 'https://x/anno.pdf?token=t',
        bytes: 1,
        annotatedPages: 1,
        drawnStrokes: 1,
      })
    })
  })
})
