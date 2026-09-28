// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { formatRehearsalRange } from '@/lib/date-utils'
import LeaveRequest from './index'

/**
 * 这个页面的重点是**草稿保护**：chooseMedia 打开相册时页面可能被销毁重建，
 * 重建后用户填的理由与选好的附件不能丢。
 *
 * 缓存（`useEditDraft` / `usePageRestore`）是**模块级**的，所以：
 * - 每个用例用**不同的排练 id**（草稿按 id 隔离），避免互相污染；
 * - 「重建」用 unmount + 重新 render 模拟（并以空 router.params 表示参数丢失）。
 */

const REHEARSAL = {
  id: 0,
  start_time: '2026-09-20T19:00:00',
  end_time: '2026-09-20T21:00:00',
  location: '排练厅',
}

/** 可变的 router：用例通过 setRoute 摆布「带参进入」与「参数丢失」 */
const route: { path: string; params: Record<string, string> } = {
  path: 'pages/leave-request/index',
  params: {},
}

function setRoute(rehearsalId: number | null) {
  route.path = 'pages/leave-request/index'
  route.params =
    rehearsalId === null ? {} : { rehearsalId: String(rehearsalId), start: '', end: '' }
  REHEARSAL.id = rehearsalId ?? 0
}

const mocks = vi.hoisted(() => ({
  fetchMine: vi.fn(async (): Promise<unknown[]> => []),
  // 参数签名要写出来：否则 mock.calls[0][0] 在 tsc 眼里是越界访问
  create: vi.fn(async (_input: Record<string, unknown>) => true),
  updateReason: vi.fn(async (_id: number, _payload: Record<string, unknown>) => true),
  reapply: vi.fn(async (_id: number, _payload: Record<string, unknown>) => true),
  cancelRequest: vi.fn(async (_id: number, _row: unknown) => true),
  uploadAttachment: vi.fn(async () => ({ url: 'https://x/new.jpg', error: null })),
  getSignedUrl: vi.fn(async () => ({ url: 'https://x/old.jpg', error: null })),
  chooseMedia: vi.fn(),
  showModal: vi.fn(async () => ({ confirm: true, cancel: false })),
  showToast: vi.fn(),
  maybeSingle: vi.fn(async () => ({ data: REHEARSAL as unknown, error: null })),
}))

vi.mock('@tarojs/components', () => {
  const create = (tag: string) => (props: Record<string, unknown>) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  // Input/Textarea 要把 DOM 事件翻译成 Taro 的 { detail: { value } } 形状——
  // 页面读的是 e.detail.value，直接透传 DOM 事件会拿到 undefined
  const toTaroInput = (tag: string) => (props: Record<string, unknown>) => {
    const { onInput, ...rest } = props as { onInput?: (e: unknown) => void }
    return React.createElement(tag, {
      ...rest,
      onChange: (e: { target?: { value?: string } }) =>
        onInput?.({ detail: { value: e?.target?.value } }),
      onInput: (e: { target?: { value?: string } }) =>
        onInput?.({ detail: { value: e?.target?.value } }),
    })
  }
  return {
    View: create('div'),
    ScrollView: create('div'),
    Text: create('span'),
    Button: create('button'),
    Image: (props: Record<string, unknown>) => React.createElement('img', props),
    Input: toTaroInput('input'),
    Textarea: toTaroInput('textarea'),
  }
})

vi.mock('@tarojs/taro', () => ({
  default: {
    getCurrentInstance: () => ({ router: route }),
    chooseMedia: mocks.chooseMedia,
    showModal: mocks.showModal,
    showToast: mocks.showToast,
    previewImage: vi.fn(),
  },
  useDidShow: (fn: () => void) => {
    const cb = React.useCallback(fn, [fn])
    React.useEffect(() => {
      cb()
    }, [cb])
  },
}))

vi.mock('@/context/theme-context', () => ({ useThemeClass: () => '' }))
vi.mock('@/context/user-context', () => ({ useUser: () => ({ user: { id: 'u1' } }) }))
vi.mock('@/hooks/useLeaveRequests', () => ({
  useLeaveRequests: () => ({
    fetchMine: mocks.fetchMine,
    create: mocks.create,
    updateReason: mocks.updateReason,
    reapply: mocks.reapply,
    cancelRequest: mocks.cancelRequest,
    uploadAttachment: mocks.uploadAttachment,
    getSignedUrl: mocks.getSignedUrl,
    saving: false,
  }),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
    }),
  },
}))
vi.mock('@/i18n', async () => {
  const mod = await import('@/i18n/messages/zh-CN')
  const dict = mod.zhCN as Record<string, unknown>
  const get = (k: string, p?: Record<string, unknown>): string => {
    const val = k
      .split('.')
      .reduce<unknown>(
        (o, key) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[key] : undefined),
        dict
      )
    let s = typeof val === 'string' ? val : k
    if (p)
      s = s.replace(/\{(\w+)\}/g, (_, key) => (p[key] !== undefined ? String(p[key]) : `{${key}}`))
    return s
  }
  return {
    useT: () => ({
      t: (k: string, p?: Record<string, unknown>) => get(k, p),
      locale: 'zh-CN',
      setLocale: vi.fn(),
    }),
    useNavTitle: vi.fn(),
  }
})

/** 渲染页面并等它拉完「我的申请」进入表单态 */
async function renderForm(rehearsalId: number) {
  setRoute(rehearsalId)
  const view = render(<LeaveRequest />)
  await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy())
  return view
}

function typeReason(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
}

/** 选图：chooseMedia 的成功回调同步触发（与真机上的时序无关，这里只验状态流转） */
function pickAttachment(path: string) {
  mocks.chooseMedia.mockImplementation((opts: { success?: (r: unknown) => void }) => {
    opts.success?.({ tempFiles: [{ tempFilePath: path }] })
  })
  fireEvent.click(screen.getByText('添加附件'))
}

beforeEach(() => {
  mocks.fetchMine.mockResolvedValue([])
  mocks.create.mockResolvedValue(true)
  mocks.cancelRequest.mockResolvedValue(true)
  mocks.showModal.mockResolvedValue({ confirm: true, cancel: false })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('请假申请页', () => {
  it('理由为空时提交被拦截，不写库', async () => {
    await renderForm(101)
    fireEvent.click(screen.getByText('提交申请'))

    await waitFor(() => expect(screen.getByText('请填写请假原因')).toBeTruthy())
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('填了理由即可提交，载荷是排练 id + 用户 id + 理由', async () => {
    await renderForm(102)
    typeReason('  家里有事  ')
    fireEvent.click(screen.getByText('提交申请'))

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      rehearsal_id: 102,
      user_id: 'u1',
      reason: '家里有事', // 两侧空白被 trim
      attachment_url: null,
    })
  })

  it('页面被销毁重建后，填的理由与选好的附件都还在（草稿保护）', async () => {
    const first = await renderForm(103)
    typeReason('家里有事')
    pickAttachment('tmp/attach.jpg')
    // 选图后附件预览应已出现
    await waitFor(() =>
      expect(first.container.querySelector('img[src="tmp/attach.jpg"]')).toBeTruthy()
    )

    // 模拟 chooseMedia 之后页面被销毁重建：卸载，且重挂时 router.params 已丢
    first.unmount()
    setRoute(null)
    const second = render(<LeaveRequest />)

    // 理由要还原
    await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy())
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('家里有事')
    // 附件预览也要还原（这是草稿快照里最容易被忽略的一项）
    expect(second.container.querySelector('img[src="tmp/attach.jpg"]')).toBeTruthy()
    // 排练信息也还在——参数走 usePageRestore 的模块级缓存。
    // 这里验的是「数据活下来了」，不是格式化：期望值就用页面同一个格式化函数算，
    // 免得把「公式」也钉进这条用例（它由 date-utils 自己的测试负责）。
    expect(
      screen.getByText(formatRehearsalRange(REHEARSAL.start_time, REHEARSAL.end_time))
    ).toBeTruthy()
  })

  it('提交成功后草稿被清除：再次进入不会冒出上次填的内容', async () => {
    const first = await renderForm(104)
    typeReason('上次填的内容')
    fireEvent.click(screen.getByText('提交申请'))
    await waitFor(() => expect(mocks.create).toHaveBeenCalled())

    first.unmount()
    setRoute(null)
    render(<LeaveRequest />)

    await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy())
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
  })

  it('已有待审批申请时进入查看态，点「编辑申请」预填原理由', async () => {
    mocks.fetchMine.mockResolvedValue([
      {
        id: 9,
        rehearsal_id: 105,
        user_id: 'u1',
        reason: '原来的理由',
        status: 'pending',
        attachment_url: null,
      },
    ])
    setRoute(105)
    render(<LeaveRequest />)

    // 查看态：状态与理由都展示出来，没有输入框
    await waitFor(() => expect(screen.getByText('待审批')).toBeTruthy())
    expect(screen.getByText('原来的理由')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()

    fireEvent.click(screen.getByText(/编辑申请/))

    // 编辑态：输入框出现且预填
    await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy())
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('原来的理由')
  })

  it('撤销申请要先确认：确认后才真的撤销，取消则什么都不做', async () => {
    mocks.fetchMine.mockResolvedValue([
      {
        id: 8,
        rehearsal_id: 106,
        user_id: 'u1',
        reason: '理由',
        status: 'pending',
        attachment_url: null,
      },
    ])
    setRoute(106)
    render(<LeaveRequest />)
    // 「撤销申请」只在编辑态出现（查看态那一行是「编辑申请」）——先点进去
    await waitFor(() => expect(screen.getByText(/编辑申请/)).toBeTruthy())
    fireEvent.click(screen.getByText(/编辑申请/))
    await waitFor(() => expect(screen.getByText(/撤销申请/)).toBeTruthy())

    // 先点「取消」
    mocks.showModal.mockResolvedValueOnce({ confirm: false, cancel: true })
    fireEvent.click(screen.getByText(/撤销申请/))
    await waitFor(() => expect(mocks.showModal).toHaveBeenCalled())
    expect(mocks.cancelRequest).not.toHaveBeenCalled()

    // 再点「确定」
    fireEvent.click(screen.getByText(/撤销申请/))
    await waitFor(() => expect(mocks.cancelRequest).toHaveBeenCalledWith(8, expect.anything()))
  })
})
