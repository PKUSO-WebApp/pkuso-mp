// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mapAuthErrorToMessage, useLogin } from '../useLogin'

const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn() }))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ signIn: signInMock }),
}))

// 模块加载即校验环境变量，mock 掉 supabase 模块（测试显式传 client）
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

// 入口路由由 routeAfterLogin 承担（其行为另有单测），此处断言「委托了路由」
const { routeAfterLoginMock } = vi.hoisted(() => ({ routeAfterLoginMock: vi.fn() }))
vi.mock('@/lib/post-auth-route', () => ({ routeAfterLogin: routeAfterLoginMock }))

/** 测试专用 client：登录成功后仅转发给 routeAfterLogin（已 mock），无需真实方法 */
const makeClient = () => ({})

describe('mapAuthErrorToMessage', () => {
  it('invalid_credentials / 401 / Invalid login credentials → 邮箱或密码错误', () => {
    expect(mapAuthErrorToMessage({ message: 'x', code: 'invalid_credentials' })).toBe(
      '邮箱或密码错误'
    )
    expect(mapAuthErrorToMessage({ message: 'x', status: 401 })).toBe('邮箱或密码错误')
    expect(mapAuthErrorToMessage({ message: 'Invalid login credentials' })).toBe('邮箱或密码错误')
  })

  it('网络类（fetch/timeout/network/fail 或空 message）→ 网络异常，请重试', () => {
    expect(mapAuthErrorToMessage(new TypeError('fetch failed'))).toBe('网络异常，请重试')
    expect(mapAuthErrorToMessage({ message: 'request timeout' })).toBe('网络异常，请重试')
    expect(mapAuthErrorToMessage({ message: '' })).toBe('网络异常，请重试')
  })

  it('其他错误 → 登录失败，请稍后重试', () => {
    expect(mapAuthErrorToMessage({ message: 'Internal Server Error' })).toBe('登录失败，请稍后重试')
  })

  it('非错误对象（null/undefined/原始值）→ 登录失败，请稍后重试', () => {
    expect(mapAuthErrorToMessage(null)).toBe('登录失败，请稍后重试')
    expect(mapAuthErrorToMessage(undefined)).toBe('登录失败，请稍后重试')
    expect(mapAuthErrorToMessage('oops')).toBe('登录失败，请稍后重试')
  })
})

describe('useLogin', () => {
  beforeEach(() => {
    signInMock.mockReset()
    signInMock.mockResolvedValue({ error: null })
    routeAfterLoginMock.mockReset()
    routeAfterLoginMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
  })

  it('空输入校验：邮箱密码均未填，不调用 signIn', async () => {
    const client = makeClient()
    const { result } = renderHook(() => useLogin(client as never))
    await act(async () => {
      await result.current.handleSubmit()
    })
    expect(result.current.errorMsg).toBe('请输入邮箱和密码。')
    expect(signInMock).not.toHaveBeenCalled()
    expect(routeAfterLoginMock).not.toHaveBeenCalled()
  })

  it('空输入校验：仅密码未填，不调用 signIn', async () => {
    const client = makeClient()
    const { result } = renderHook(() => useLogin(client as never))
    act(() => result.current.setEmail('a@b.com'))
    await act(async () => {
      await result.current.handleSubmit()
    })
    expect(result.current.errorMsg).toBe('请输入邮箱和密码。')
    expect(signInMock).not.toHaveBeenCalled()
  })

  it('登录成功：trim 邮箱后调用 signIn，委托入口路由（RPC 以会话 JWT 为准）', async () => {
    const client = makeClient()
    const { result } = renderHook(() => useLogin(client as never))
    act(() => result.current.setEmail(' a@b.com '))
    act(() => result.current.setPassword('pw123'))
    await act(async () => {
      await result.current.handleSubmit()
    })
    expect(signInMock).toHaveBeenCalledWith('a@b.com', 'pw123')
    expect(result.current.errorMsg).toBe('')
    expect(routeAfterLoginMock).toHaveBeenCalledWith(client)
  })

  it('密码错误：显示映射后的中文文案且不跳转', async () => {
    signInMock.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    const client = makeClient()
    const { result } = renderHook(() => useLogin(client as never))
    act(() => result.current.setEmail('a@b.com'))
    act(() => result.current.setPassword('wrong'))
    await act(async () => {
      await result.current.handleSubmit()
    })
    expect(result.current.errorMsg).toBe('邮箱或密码错误')
    expect(routeAfterLoginMock).not.toHaveBeenCalled()
  })

  it('signIn reject（AuthError）：submitting 复位且文案走映射表', async () => {
    signInMock.mockRejectedValue(new Error('Invalid login credentials'))
    const client = makeClient()
    const { result } = renderHook(() => useLogin(client as never))
    act(() => result.current.setEmail('a@b.com'))
    act(() => result.current.setPassword('wrong'))
    await act(async () => {
      await result.current.handleSubmit()
    })
    expect(result.current.errorMsg).toBe('邮箱或密码错误')
    expect(result.current.submitting).toBe(false)
    expect(routeAfterLoginMock).not.toHaveBeenCalled()
  })

  it('signIn reject（网络异常）：归一化为网络错误且 submitting 复位', async () => {
    signInMock.mockRejectedValue(new TypeError('fetch failed'))
    const client = makeClient()
    const { result } = renderHook(() => useLogin(client as never))
    act(() => result.current.setEmail('a@b.com'))
    act(() => result.current.setPassword('pw'))
    await act(async () => {
      await result.current.handleSubmit()
    })
    expect(result.current.errorMsg).toBe('网络异常，请重试')
    expect(result.current.submitting).toBe(false)
    expect(routeAfterLoginMock).not.toHaveBeenCalled()
  })

  it('请求进行中 submitting 为 true，完成后恢复', async () => {
    let resolveSignIn!: (value: unknown) => void
    signInMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSignIn = resolve
      })
    )
    const client = makeClient()
    const { result } = renderHook(() => useLogin(client as never))
    act(() => result.current.setEmail('a@b.com'))
    act(() => result.current.setPassword('pw'))
    let pending!: Promise<void>
    act(() => {
      pending = result.current.handleSubmit()
    })
    expect(result.current.submitting).toBe(true)
    await act(async () => {
      resolveSignIn({ error: null })
      await pending
    })
    expect(result.current.submitting).toBe(false)
  })

  it('双重提交 guard：请求进行中重复提交不重复调用 signIn（含同一 render 双击）', async () => {
    let resolveSignIn!: (value: unknown) => void
    signInMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSignIn = resolve
      })
    )
    const client = makeClient()
    const { result } = renderHook(() => useLogin(client as never))
    act(() => result.current.setEmail('a@b.com'))
    act(() => result.current.setPassword('pw'))
    let first!: Promise<void>
    act(() => {
      // 同一 render 内连点两次（state 闭包未更新），靠 ref 兜底只提交一次
      first = result.current.handleSubmit()
      void result.current.handleSubmit()
    })
    expect(signInMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveSignIn({ error: null })
      await first
    })
    // 完成后可再次提交
    expect(result.current.submitting).toBe(false)
  })
})
