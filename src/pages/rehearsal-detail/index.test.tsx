// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import RehearsalDetail from './index'

/**
 * 排练详情页：分享链接进来的未登录守卫、按 id 直取排练、签到/请假入口。
 *
 * 签到本身的判据（时间窗、地理围栏、状态机）在 `lib/attendance-utils` 与 `lib/geo`
 * 里各有单测，这里只压页面自己的事：守卫跳转、渲染、取不到排练时的表现、入口参数。
 */

const REHEARSAL = {
  id: 7,
  repertoire: '肖斯塔科维奇第五交响曲',
  title: null,
  location: '新太阳排练厅',
  // ⚠️ **必须是一个不会到来的时间**。这组用例断的是「未结束」那一支的入口文案
  // （`我要请假`），而页面在排练结束后会改渲染 `我要补请假` —— 日期一旦写死成过去，
  // 用例就在那一天之后**恒红**（实测：2026-10-01 21:00 之后 main 的闸门一直挂在
  // 这两条上，看起来像「谁的改动弄坏了」，其实与任何改动无关）。
  start_time: '2099-05-01T19:00:00',
  end_time: '2099-05-01T21:00:00',
  section_group: null,
  targets: null,
}

/**
 * 可变的登录态与路由：用例按需摆布。
 *
 * ⚠️ 「参数丢失」的用例必须用**自己的页面路径**：`usePageRestore` 的参数缓存是
 * 模块级的、按路径存，而且**参数缺失时会回落到上次缓存的值**（这正是它的用途）。
 * 同一个路径连跑几条用例，前一条缓存下来的 id 会让「无参」那条拿到旧值。
 */
const state = {
  ready: true,
  user: null as null | { id: string },
  restoreFailed: false,
  retryRestore: vi.fn(async () => undefined),
  route: { path: 'pages/rehearsal-detail/index', params: {} as Record<string, string> },
}

function setRoute(params: Record<string, string>, pathSuffix = '') {
  state.route = { path: `pages/rehearsal-detail/index${pathSuffix}`, params }
}

const mocks = vi.hoisted(() => ({
  redirectTo: vi.fn(async () => undefined),
  navigateTo: vi.fn(async () => undefined),
  showToast: vi.fn(),
  maybeSingle: vi.fn(),
  fetchMyAttendances: vi.fn(async () => undefined),
  signIn: vi.fn(async () => ({ ok: true })),
  fetchMine: vi.fn(async () => []),
  cancelOnSignIn: vi.fn(async () => true),
  getSession: vi.fn(
    async (): Promise<{
      data: { session: { access_token: string } | null }
      error: unknown
    }> => ({ data: { session: { access_token: 't' } }, error: null })
  ),
  signOut: vi.fn(async () => ({ error: null })),
}))

vi.mock('@tarojs/components', () => {
  const create = (tag: string) => (props: Record<string, unknown>) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return {
    View: create('div'),
    Text: create('span'),
    ScrollView: create('div'),
    Button: create('button'),
    Image: (props: Record<string, unknown>) => React.createElement('img', props),
  }
})

vi.mock('@tarojs/taro', () => ({
  default: {
    getCurrentInstance: () => ({ router: state.route }),
    redirectTo: mocks.redirectTo,
    navigateTo: mocks.navigateTo,
    showToast: mocks.showToast,
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
    getLocation: vi.fn(),
    showModal: vi.fn(),
    openSetting: vi.fn(),
  },
  useDidShow: vi.fn(),
  useShareAppMessage: vi.fn(),
}))

vi.mock('@/context/theme-context', () => ({ useThemeClass: () => '' }))
vi.mock('@/context/user-context', () => ({
  useUser: () => ({
    ready: state.ready,
    user: state.user,
    restoreFailed: state.restoreFailed,
    retryRestore: state.retryRestore,
  }),
}))
vi.mock('@/hooks/useAttendance', () => ({
  useAttendance: () => ({
    map: {},
    loading: false,
    fetchMyAttendances: mocks.fetchMyAttendances,
    signIn: mocks.signIn,
  }),
}))
vi.mock('@/hooks/useLeaveRequests', () => ({
  useLeaveRequests: () => ({
    data: [],
    cancelOnSignIn: mocks.cancelOnSignIn,
    fetchMine: mocks.fetchMine,
  }),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
    auth: {
      getSession: mocks.getSession,
      signOut: mocks.signOut,
    },
  },
}))
vi.mock('@/lib/rehearsalSeen', () => ({ markRehearsalSeen: vi.fn() }))
vi.mock('@/lib/session-diag', () => ({ logDiag: vi.fn() }))
vi.mock('@/constants/instruments', () => ({
  getSectionGroupLabel: (v: unknown) => String(v ?? ''),
  INSTRUMENT_ORDER: [],
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

beforeEach(() => {
  state.ready = true
  state.user = { id: 'u1' }
  state.restoreFailed = false
  state.retryRestore.mockClear()
  setRoute({ id: '7' })
  mocks.maybeSingle.mockResolvedValue({ data: REHEARSAL, error: null })
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('排练详情页', () => {
  it('未登录（分享链接进来）：跳登录页并带上 returnTo，原参数不丢', async () => {
    state.user = null
    render(<RehearsalDetail />)

    await waitFor(() => expect(mocks.redirectTo).toHaveBeenCalledTimes(1))
    const url = (mocks.redirectTo.mock.calls[0] as unknown as [{ url: string }])[0].url
    expect(url).toContain('/pages/login/index?returnTo=')
    // returnTo 里要能还原出「回到本页 + 原参数」
    const returnTo = decodeURIComponent(url.split('returnTo=')[1])
    expect(returnTo).toContain('pages/rehearsal-detail/index')
    expect(returnTo).toContain('id=7')
  })

  it('已登录：渲染排练时间/地点/曲目，并给出请假入口', async () => {
    render(<RehearsalDetail />)

    await waitFor(() => expect(screen.getByText('新太阳排练厅')).toBeTruthy())
    expect(screen.getByText('肖斯塔科维奇第五交响曲')).toBeTruthy()
    expect(screen.getByText('排练地点')).toBeTruthy()
    expect(screen.getByText(/我要请假/)).toBeTruthy()
  })

  it('排练已被删除（0 行）：显示「排练不存在」，不抛错', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    render(<RehearsalDetail />)

    await waitFor(() => expect(screen.getByText('排练不存在')).toBeTruthy())
  })

  it('路由没有 id：不查库，直接显示「排练不存在」', async () => {
    setRoute({}, '/no-id') // 独立路径：避免撞上前几条用例缓存的 id
    render(<RehearsalDetail />)

    await waitFor(() => expect(screen.getByText('排练不存在')).toBeTruthy())
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
  })

  it('请假入口带上排练 id 与起止时间（时间经 URL 编码）', async () => {
    render(<RehearsalDetail />)
    await waitFor(() => expect(screen.getByText(/我要请假/)).toBeTruthy())

    fireEvent.click(screen.getByText(/我要请假/))

    expect(mocks.navigateTo).toHaveBeenCalledTimes(1)
    const url = (mocks.navigateTo.mock.calls[0] as unknown as [{ url: string }])[0].url
    expect(url).toContain('/pages/leave-request/index?rehearsalId=7')
    expect(url).toContain(`start=${encodeURIComponent(REHEARSAL.start_time)}`)
    expect(url).toContain(`end=${encodeURIComponent(REHEARSAL.end_time)}`)
  })

  // --- 冷启动鉴权竞态（RLS 匿名查询返回 200 [] 的那条路）---

  it('会话恢复完成前：只显示加载中，不查库、不显示不存在', async () => {
    state.ready = false
    state.user = null
    setRoute({ id: '7' }, '/auth-pending')
    render(<RehearsalDetail />)

    expect(screen.getByText(/加载中/)).toBeTruthy()
    expect(screen.queryByText('排练不存在')).toBeNull()
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
  })

  it('鉴权就绪后自动补查（ready false → true）', async () => {
    state.ready = false
    state.user = null
    setRoute({ id: '7' }, '/late-ready')
    const { rerender } = render(<RehearsalDetail />)
    expect(mocks.maybeSingle).not.toHaveBeenCalled()

    state.ready = true
    state.user = { id: 'u1' }
    rerender(<RehearsalDetail />)

    await waitFor(() => expect(screen.getByText('新太阳排练厅')).toBeTruthy())
  })

  it('查询失败：显示加载失败 + 重试，不显示「排练不存在」；重试成功后渲染', async () => {
    setRoute({ id: '7' }, '/query-error')
    mocks.maybeSingle
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout', code: 'PGRST000' } })
      .mockResolvedValueOnce({ data: REHEARSAL, error: null })
    render(<RehearsalDetail />)

    await waitFor(() => expect(screen.getByText('数据加载失败，请重试')).toBeTruthy())
    expect(screen.queryByText('排练不存在')).toBeNull()

    fireEvent.click(screen.getByText('重试'))
    await waitFor(() => expect(screen.getByText('新太阳排练厅')).toBeTruthy())
  })

  it('空结果但会话已失效：不显示「排练不存在」，清本地会话', async () => {
    setRoute({ id: '7' }, '/no-session')
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
    render(<RehearsalDetail />)

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' }))
    expect(screen.queryByText('排练不存在')).toBeNull()
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
  })

  it('getSession 返回 refresh token 定论失效：清本地会话，不显示「排练不存在」', async () => {
    setRoute({ id: '7' }, '/token-invalid')
    mocks.getSession.mockResolvedValue({
      data: { session: null },
      error: Object.assign(new Error('Invalid Refresh Token'), {
        name: 'AuthApiError',
        status: 400,
        code: 'refresh_token_not_found',
      }),
    })
    render(<RehearsalDetail />)

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' }))
    expect(screen.queryByText('排练不存在')).toBeNull()
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
  })

  it('getSession 网络失败：显示加载失败 + 重试，不显示「排练不存在」', async () => {
    setRoute({ id: '7' }, '/session-network')
    mocks.getSession.mockRejectedValue(new Error('request:fail timeout'))
    render(<RehearsalDetail />)

    await waitFor(() => expect(screen.getByText('数据加载失败，请重试')).toBeTruthy())
    expect(screen.queryByText('排练不存在')).toBeNull()
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
  })

  it('会话恢复失败：显示重试、不跳登录；点重试调用 retryRestore', async () => {
    state.user = null
    state.restoreFailed = true
    setRoute({ id: '7' }, '/restore-failed')
    render(<RehearsalDetail />)

    await waitFor(() => expect(screen.getByText('数据加载失败，请重试')).toBeTruthy())
    expect(mocks.redirectTo).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('重试'))
    await waitFor(() => expect(state.retryRestore).toHaveBeenCalled())
  })
})
