// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWechatLogin } from '../useWechatLogin'

const { taroMock } = vi.hoisted(() => {
  const mock = {
    login: vi.fn(),
    showToast: vi.fn(),
    reLaunch: vi.fn(),
  }
  ;(mock as unknown as Record<string, unknown>).default = mock
  return { taroMock: mock }
})
vi.mock('@tarojs/taro', () => taroMock)

// 模块加载即校验环境变量，直接 mock 掉 supabase 模块（测试显式传 client）
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

// 只替换上报函数，保留 describeError 的真实实现
const { reportClientErrorMock } = vi.hoisted(() => ({ reportClientErrorMock: vi.fn() }))
vi.mock('@/lib/error-report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/error-report')>()),
  reportClientError: reportClientErrorMock,
}))

// 入口路由由 routeAfterLogin 承担（其行为另有单测），此处断言「委托了路由」
const { routeAfterLoginMock } = vi.hoisted(() => ({ routeAfterLoginMock: vi.fn() }))
vi.mock('@/lib/post-auth-route', () => ({ routeAfterLogin: routeAfterLoginMock }))

type InvokeResponse = { data: unknown; error: unknown }

function mockClient(
  invokeResponse: InvokeResponse,
  setSessionResult:
    { data: { session: { user: { id: string } } }; error: null } | { error: { message: string } }
) {
  return {
    functions: {
      invoke: vi.fn().mockResolvedValue(invokeResponse),
    },
    auth: {
      setSession: vi.fn().mockResolvedValue(setSessionResult),
    },
    rpc: vi.fn().mockResolvedValue({
      data: [{ session_token: 't-local', session_started_at: '2026-08-22T10:00:00Z' }],
      error: null,
    }),
  }
}

const sessionOk = (id = 'u1') => ({
  data: { session: { user: { id } } },
  error: null,
})

describe('useWechatLogin', () => {
  afterEach(() => {
    cleanup()
    taroMock.login.mockReset()
    taroMock.reLaunch.mockReset()
    taroMock.showToast.mockReset()
    routeAfterLoginMock.mockReset()
    reportClientErrorMock.mockReset()
  })

  it('微信登录成功：setSession + 委托 routeAfterLogin 路由入口', async () => {
    taroMock.login.mockResolvedValue({ code: 'wx-code-1' })
    const c = mockClient(
      { data: { access_token: 'at', refresh_token: 'rt', is_new: false }, error: null },
      sessionOk()
    )
    const { result } = renderHook(() => useWechatLogin(c as never))
    const res = await act(() => result.current.loginWithWechat())
    expect(res.error).toBeNull()
    expect(c.auth.setSession).toHaveBeenCalledWith({
      access_token: 'at',
      refresh_token: 'rt',
    })
    // 路由委托给 routeAfterLogin（资料补全/等待审核/审核未通过/首页判定在其内部；
    // RPC 以会话 JWT 的 auth.uid() 为准，无需传 userId）
    expect(routeAfterLoginMock).toHaveBeenCalledWith(c)
  })

  it('新注册用户登录成功：同样走统一入口路由（full_name 为空自然落补全页）', async () => {
    taroMock.login.mockResolvedValue({ code: 'wx-code-1' })
    const c = mockClient(
      { data: { access_token: 'at', refresh_token: 'rt', is_new: true }, error: null },
      sessionOk('u-new')
    )
    const { result } = renderHook(() => useWechatLogin(c as never))
    const res = await act(() => result.current.loginWithWechat())
    expect(res.error).toBeNull()
    expect(routeAfterLoginMock).toHaveBeenCalledWith(c)
  })

  it('code2session 失败：映射专属文案', async () => {
    taroMock.login.mockResolvedValue({ code: 'wx-code-1' })
    const invokeError = new Error('functions error') as Error & {
      context?: { json: () => Promise<{ error?: string }> }
    }
    invokeError.context = { json: () => Promise.resolve({ error: 'wechat code2session failed' }) }
    const c = mockClient({ data: null, error: invokeError }, sessionOk())
    const { result } = renderHook(() => useWechatLogin(c as never))
    const res = await act(() => result.current.loginWithWechat())
    expect(res.error).toBe('微信登录失败，code 已过期，请重试')
    expect(c.auth.setSession).not.toHaveBeenCalled()
  })

  it('Taro.login 无 code：失败且不发请求', async () => {
    taroMock.login.mockResolvedValue({ code: '' })
    const c = mockClient({ data: null, error: null }, sessionOk())
    const { result } = renderHook(() => useWechatLogin(c as never))
    const res = await act(() => result.current.loginWithWechat())
    expect(res.error).toBe('微信登录失败，请重试')
    expect(c.functions.invoke).not.toHaveBeenCalled()
  })

  it('setSession 失败：不路由', async () => {
    taroMock.login.mockResolvedValue({ code: 'wx-code-1' })
    const c = mockClient(
      { data: { access_token: 'at', refresh_token: 'rt' }, error: null },
      { error: { message: 'session error' } }
    )
    const { result } = renderHook(() => useWechatLogin(c as never))
    const res = await act(() => result.current.loginWithWechat())
    expect(res.error).toBe('微信登录失败，请重试')
    expect(routeAfterLoginMock).not.toHaveBeenCalled()
  })

  it('setSession 成功但会话缺 user id：不路由', async () => {
    taroMock.login.mockResolvedValue({ code: 'wx-code-1' })
    const c = mockClient(
      { data: { access_token: 'at', refresh_token: 'rt' }, error: null },
      // 缺 session.user 的异常形态
      { data: { session: null as never }, error: null }
    )
    const { result } = renderHook(() => useWechatLogin(c as never))
    const res = await act(() => result.current.loginWithWechat())
    expect(res.error).toBe('微信登录失败，请重试')
    expect(routeAfterLoginMock).not.toHaveBeenCalled()
  })

  it('防重复提交：提交中二次调用直接拒绝', async () => {
    taroMock.login.mockResolvedValue({ code: 'wx-code-1' })
    const c = mockClient(
      { data: { access_token: 'at', refresh_token: 'rt' }, error: null },
      sessionOk()
    )
    const { result } = renderHook(() => useWechatLogin(c as never))
    const first = act(() => result.current.loginWithWechat())
    const second = await act(() => result.current.loginWithWechat())
    expect(second.error).toBe('请勿重复提交')
    await first
  })

  // --- 关联 id（与服务端 _shared/diag.ts 对账）---

  it('invoke 失败：请求头带关联 id，失败记录用**同一个** id——两端靠它对上', async () => {
    taroMock.login.mockResolvedValue({ code: 'wx-code-1' })
    const invokeError = new Error('functions error') as Error & {
      name: string
      context?: { status?: number; json: () => Promise<{ error?: string }> }
    }
    invokeError.name = 'FunctionsHttpError'
    invokeError.context = {
      status: 502,
      json: () => Promise.resolve({ error: 'token exchange failed' }),
    }
    const c = mockClient({ data: null, error: invokeError }, sessionOk())
    const { result } = renderHook(() => useWechatLogin(c as never))
    await act(() => result.current.loginWithWechat())

    // 请求头里必须带（服务端据此把它写进自己的日志行）
    const diag = c.functions.invoke.mock.calls[0][1].headers['x-pkuso-diag'] as string
    expect(diag).toMatch(/^[A-Za-z0-9._-]{1,64}$/)

    const reported = reportClientErrorMock.mock.calls
      .map((call) => call[0] as { detail?: Record<string, unknown> })
      .find((input) => input.detail?.step === 'invoke')
    expect(reported).toBeDefined()
    // 同一个值：这就是「请求有没有送到」的判据（只有客户端有 = 没送到）
    expect(reported?.detail?.diag).toBe(diag)
    // 平台网关（502/504，响应体不是我们的 JSON）与我们自己函数的错误，只靠状态码分得开
    expect(reported?.detail?.httpStatus).toBe(502)
    expect(reported?.detail?.serverError).toBe('token exchange failed')
    expect(reported?.detail?.errorName).toBe('FunctionsHttpError')
  })

  it('setSession 失败：记下 GoTrue 的 code 与状态码（判「被别的设备顶掉」还是「服务端 5xx」）', async () => {
    taroMock.login.mockResolvedValue({ code: 'wx-code-1' })
    const c = mockClient(
      { data: { access_token: 'at', refresh_token: 'rt' }, error: null },
      {
        error: {
          message: 'Invalid Refresh Token',
          name: 'AuthApiError',
          code: 'refresh_token_not_found',
          status: 400,
        },
      } as never
    )
    const { result } = renderHook(() => useWechatLogin(c as never))
    await act(() => result.current.loginWithWechat())

    const reported = reportClientErrorMock.mock.calls
      .map((call) => call[0] as { message: string; detail?: Record<string, unknown> })
      .find((input) => input.detail?.step === 'set_session')
    expect(reported?.message).toBe('Invalid Refresh Token')
    expect(reported?.detail).toMatchObject({
      errorCode: 'refresh_token_not_found',
      httpStatus: 400,
    })
  })

  it('wx.login 失败发生在发请求之前：不生成关联 id（那时服务端什么都不会有）', async () => {
    taroMock.login.mockRejectedValue({ errMsg: 'login:fail timeout' })
    const c = mockClient({ data: null, error: null }, sessionOk())
    const { result } = renderHook(() => useWechatLogin(c as never))
    await act(() => result.current.loginWithWechat())

    expect(c.functions.invoke).not.toHaveBeenCalled()
    const reported = reportClientErrorMock.mock.calls
      .map((call) => call[0] as { detail?: Record<string, unknown> })
      .find((input) => input.detail?.step === 'wx_login')
    expect(reported?.detail?.errMsg).toBe('login:fail timeout')
    // 没有请求就没有可对账的 id——记一个服务端永远不会有的是误导
    expect(reported?.detail?.diag).toBeUndefined()
  })
})
