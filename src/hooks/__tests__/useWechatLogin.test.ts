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
    // 路由委托给 routeAfterLogin（资料补全/等待审核/审核未通过/首页判定在其内部）
    expect(routeAfterLoginMock).toHaveBeenCalledWith(c, 'u1')
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
    expect(routeAfterLoginMock).toHaveBeenCalledWith(c, 'u-new')
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
})
