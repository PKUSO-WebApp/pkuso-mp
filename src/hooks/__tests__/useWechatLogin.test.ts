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

function mockClient<T>(invokeResponse: T, setSessionError: { message: string } | null = null) {
  return {
    functions: {
      invoke: vi.fn().mockResolvedValue(invokeResponse),
    },
    auth: {
      setSession: vi.fn().mockResolvedValue({ error: setSessionError }),
    },
  }
}

describe('useWechatLogin', () => {
  afterEach(() => {
    cleanup()
    taroMock.login.mockReset()
    taroMock.reLaunch.mockReset()
    taroMock.showToast.mockReset()
  })

  it('微信登录成功：setSession + reLaunch 首页', async () => {
    taroMock.login.mockResolvedValue({ code: 'wx-code-1' })
    const c = mockClient({
      data: { access_token: 'at', refresh_token: 'rt', is_new: false },
      error: null,
    })
    const { result } = renderHook(() => useWechatLogin(c as never))
    const res = await act(() => result.current.loginWithWechat())
    expect(res.error).toBeNull()
    expect(c.auth.setSession).toHaveBeenCalledWith({
      access_token: 'at',
      refresh_token: 'rt',
    })
    expect(taroMock.reLaunch).toHaveBeenCalledWith({ url: '/pages/index/index' })
  })

  it('新注册用户登录成功：提示等待管理员审核', async () => {
    taroMock.login.mockResolvedValue({ code: 'wx-code-1' })
    const c = mockClient({
      data: { access_token: 'at', refresh_token: 'rt', is_new: true },
      error: null,
    })
    const { result } = renderHook(() => useWechatLogin(c as never))
    await act(() => result.current.loginWithWechat())
    expect(taroMock.showToast).toHaveBeenCalledWith({
      title: '账号已创建，等待管理员审核',
      icon: 'none',
    })
  })

  it('code2session 失败：映射专属文案', async () => {
    taroMock.login.mockResolvedValue({ code: 'wx-code-1' })
    const invokeError = new Error('functions error') as Error & {
      context?: { json: () => Promise<{ error?: string }> }
    }
    invokeError.context = { json: () => Promise.resolve({ error: 'wechat code2session failed' }) }
    const c = mockClient({ data: null, error: invokeError })
    const { result } = renderHook(() => useWechatLogin(c as never))
    const res = await act(() => result.current.loginWithWechat())
    expect(res.error).toBe('微信登录失败，code 已过期，请重试')
    expect(c.auth.setSession).not.toHaveBeenCalled()
  })

  it('Taro.login 无 code：失败且不发请求', async () => {
    taroMock.login.mockResolvedValue({ code: '' })
    const c = mockClient({ data: null, error: null })
    const { result } = renderHook(() => useWechatLogin(c as never))
    const res = await act(() => result.current.loginWithWechat())
    expect(res.error).toBe('微信登录失败，请重试')
    expect(c.functions.invoke).not.toHaveBeenCalled()
  })

  it('setSession 失败：不 reLaunch', async () => {
    taroMock.login.mockResolvedValue({ code: 'wx-code-1' })
    const c = mockClient(
      { data: { access_token: 'at', refresh_token: 'rt' }, error: null },
      { message: 'session error' }
    )
    const { result } = renderHook(() => useWechatLogin(c as never))
    const res = await act(() => result.current.loginWithWechat())
    expect(res.error).toBe('微信登录失败，请重试')
    expect(taroMock.reLaunch).not.toHaveBeenCalled()
  })

  it('防重复提交：提交中二次调用直接拒绝', async () => {
    taroMock.login.mockResolvedValue({ code: 'wx-code-1' })
    const c = mockClient({
      data: { access_token: 'at', refresh_token: 'rt' },
      error: null,
    })
    const { result } = renderHook(() => useWechatLogin(c as never))
    const first = act(() => result.current.loginWithWechat())
    const second = await act(() => result.current.loginWithWechat())
    expect(second.error).toBe('请勿重复提交')
    await first
  })
})
