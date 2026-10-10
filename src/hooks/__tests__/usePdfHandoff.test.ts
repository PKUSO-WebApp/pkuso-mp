// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePdfHandoff } from '../usePdfHandoff'

// supabase 模块加载即校验环境变量 ⇒ 必须桩掉（仓里的惯例）
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

vi.mock('@tarojs/taro', () => ({
  default: {
    getDeviceInfo: () => ({ platform: 'ios' }),
    getFileSystemManager: () => ({}),
    showToast: vi.fn(),
  },
}))

// ⚠️ `t` 必须是**稳定引用**：进了依赖数组就会无限重渲染（本仓踩过，见 vitest-hook-mock 那条）
const { t } = vi.hoisted(() => ({ t: (k: string) => k }))
vi.mock('@/i18n', () => ({ useT: () => ({ t, locale: 'zh-CN', setLocale: vi.fn() }) }))

const { ensureSavedPdf, composeAnnotatedPdf, reportClientError, handOffPdf, syncAnnotationFile, order } =
  vi.hoisted(() => ({
    ensureSavedPdf: vi.fn(),
    composeAnnotatedPdf: vi.fn(),
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
  return { ...actual, composeAnnotatedPdf }
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

beforeEach(() => {
  ensureSavedPdf
    .mockReset()
    .mockImplementation(async (opts: { fileId: string }) => ({
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
})

afterEach(() => {
  cleanup()
})

describe('usePdfHandoff：是否带有批注', () => {
  it('默认不带批注：不调云端合成，直接下原件', async () => {
    const { result } = renderHook(() => usePdfHandoff())
    act(() => result.current.open(meta()))

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(composeAnnotatedPdf).not.toHaveBeenCalled()
    expect(savedCall().fileId).toBe('f1')
    expect(savedCall().url).toContain('/public/')
    expect(savedCall().force).toBe(false) // 原件那份不需要重下
  })

  it('拨到「是」：调合成、用签名 URL 与产物字节数下载，文件名带后缀', async () => {
    const { result } = renderHook(() => usePdfHandoff())
    act(() => result.current.open(meta()))
    await waitFor(() => expect(result.current.ready).toBe(true))

    act(() => result.current.toggleAnno(true))
    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(composeAnnotatedPdf).toHaveBeenCalledWith('f1')
    const last = savedCall(ensureSavedPdf.mock.calls.length - 1)
    expect(last.url).toContain('token=t')
    // 字节数取服务端给的那个确切值，分片下载才有依据
    expect(last.expectedBytes).toBe(4321)
    expect(String(last.fileName)).toContain('common.saveTo.annoSuffix')
    // ⚠️ 必须 force：本地那个路径是固定的，不强制的话**新合成的那份根本不会被下载**，
    // 交出去的是上一次的旧内容（用户又多画了几笔也照样是旧的）
    expect(last.force).toBe(true)
  })

  it('⚠️ 合成之前必须**先同步**：函数读的是服务端那份，本地没推上去就会少画几笔', async () => {
    const { result } = renderHook(() => usePdfHandoff())
    act(() => result.current.toggleAnno(true))
    act(() => result.current.open(meta()))

    await waitFor(() => expect(composeAnnotatedPdf).toHaveBeenCalled())
    expect(syncAnnotationFile).toHaveBeenCalledWith('f1')
    expect(order).toEqual(['sync', 'compose']) // 顺序也要对，不能只是都调了
  })

  it('不带批注那条路**不**去同步（没必要多一次拉取）', async () => {
    const { result } = renderHook(() => usePdfHandoff())
    act(() => result.current.open(meta()))

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(syncAnnotationFile).not.toHaveBeenCalled()
  })

  it('⚠️ 带批注那份走**另一个记账键**：先存了原件，再拨开关不能复用原件', async () => {
    const { result } = renderHook(() => usePdfHandoff())
    act(() => result.current.open(meta()))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(savedCall().fileId).toBe('f1')

    act(() => result.current.toggleAnno(true))
    await waitFor(() => expect(result.current.ready).toBe(true))

    const last = savedCall(ensureSavedPdf.mock.calls.length - 1)
    expect(last.fileId).toBe('f1#anno')
  })

  it('拨回「否」：回到原件那一份（键也回原 id）', async () => {
    const { result } = renderHook(() => usePdfHandoff())
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
    const { result } = renderHook(() => usePdfHandoff())
    act(() => result.current.open(meta()))
    await waitFor(() => expect(result.current.ready).toBe(true))

    act(() => result.current.toggleAnno(true))
    // 合成还没回来：出口必须不可点（否则交付的是**原件**，而用户要的是带批注的）
    expect(result.current.ready).toBe(false)

    await act(async () => {
      resolveCompose({ url: 'https://x/anno.pdf?token=t', bytes: 1, annotatedPages: 1, drawnStrokes: 1 })
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
  })

  it('⚠️ 慢的那次后回来也不能翻盘：带批注还在合成时拨回「否」，交付的必须是原件', async () => {
    const { AnnotatedPdfError } = await vi.importActual<typeof import('@/lib/annotated-pdf')>(
      '@/lib/annotated-pdf'
    )
    void AnnotatedPdfError
    let resolveCompose: (v: unknown) => void = () => {}
    composeAnnotatedPdf.mockReturnValue(new Promise((r) => (resolveCompose = r)))

    const { result } = renderHook(() => usePdfHandoff())
    act(() => result.current.open(meta()))
    act(() => result.current.toggleAnno(true)) // 合成挂起
    act(() => result.current.toggleAnno(false)) // 用户改主意，原件那条很快回来
    await waitFor(() => expect(result.current.ready).toBe(true))

    // 挂起的那次合成此刻才回来——它已经作废，不许把已经备好的原件顶掉
    await act(async () => {
      resolveCompose({ url: 'https://x/anno.pdf?token=t', bytes: 1, annotatedPages: 1, drawnStrokes: 1 })
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

    const { result } = renderHook(() => usePdfHandoff())
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

    const { result } = renderHook(() => usePdfHandoff())
    act(() => result.current.open(meta()))

    await waitFor(() => expect(reportClientError).toHaveBeenCalled())
    expect(result.current.preparing).toBe(false)
  })

  it('这份谱没有批注：给一句人话、**不当失败上报**（那是预期内的一种）', async () => {
    const { AnnotatedPdfError } = await vi.importActual<typeof import('@/lib/annotated-pdf')>(
      '@/lib/annotated-pdf'
    )
    composeAnnotatedPdf.mockRejectedValue(new AnnotatedPdfError('no annotations', 'no annotations'))
    const Taro = (await import('@tarojs/taro')).default

    const { result } = renderHook(() => usePdfHandoff())
    act(() => result.current.toggleAnno(true))
    act(() => result.current.open(meta()))

    await waitFor(() => expect(Taro.showToast).toHaveBeenCalled())
    expect(reportClientError).not.toHaveBeenCalled()
  })

  it('合成失败（别的错因）：上报，且出口始终不可点', async () => {
    composeAnnotatedPdf.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => usePdfHandoff())
    act(() => result.current.toggleAnno(true))
    act(() => result.current.open(meta()))

    await waitFor(() => expect(reportClientError).toHaveBeenCalled())
    expect(result.current.ready).toBe(false)
  })
})
