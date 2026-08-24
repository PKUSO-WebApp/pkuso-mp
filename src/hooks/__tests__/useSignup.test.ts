// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSignup } from '../useSignup'

const { authMock } = vi.hoisted(() => ({
  authMock: {
    signUp: vi.fn(),
  },
}))

vi.mock('@/lib/supabase', () => ({ supabase: { auth: authMock } }))

const { routeAfterLoginMock } = vi.hoisted(() => ({ routeAfterLoginMock: vi.fn() }))
vi.mock('@/lib/post-auth-route', () => ({ routeAfterLogin: routeAfterLoginMock }))

describe('useSignup', () => {
  beforeEach(() => {
    authMock.signUp.mockReset()
    routeAfterLoginMock.mockReset()
    routeAfterLoginMock.mockResolvedValue(undefined)
  })

  afterEach(() => cleanup())

  it('信息不完整时不调用接口并给出提示', async () => {
    const { result } = renderHook(() => useSignup())
    let res!: { needsEmailConfirmation: boolean }
    await act(async () => {
      res = await result.current.handleSubmit()
    })
    expect(res.needsEmailConfirmation).toBe(false)
    expect(result.current.errorMsg).toBe('请填写完整信息后再提交。')
    expect(authMock.signUp).not.toHaveBeenCalled()
  })

  it('两次密码不一致给出提示且不调用接口', async () => {
    const { result } = renderHook(() => useSignup())
    act(() => {
      result.current.setEmail('a@b.com')
      result.current.setPassword('password123')
      result.current.setConfirmPassword('different123')
      result.current.setFullName('张三')
    })
    await act(async () => {
      await result.current.handleSubmit()
    })
    expect(result.current.errorMsg).toBe('两次输入的密码不一致，请重新输入。')
    expect(authMock.signUp).not.toHaveBeenCalled()
  })

  it('密码过短给出提示且不调用接口', async () => {
    const { result } = renderHook(() => useSignup())
    act(() => {
      result.current.setEmail('a@b.com')
      result.current.setPassword('123')
      result.current.setConfirmPassword('123')
      result.current.setFullName('张三')
    })
    await act(async () => {
      await result.current.handleSubmit()
    })
    expect(result.current.errorMsg).toBe('密码长度至少为 6 位，请重新设置。')
    expect(authMock.signUp).not.toHaveBeenCalled()
  })

  it('注册成功且自动建立会话：携带 full_name 并路由到入口', async () => {
    authMock.signUp.mockResolvedValue({
      data: { session: { user: { id: 'u2' } }, user: { id: 'u2' } },
      error: null,
    })
    const { result } = renderHook(() => useSignup())
    act(() => {
      result.current.setEmail('a@b.com')
      result.current.setPassword('password123')
      result.current.setConfirmPassword('password123')
      result.current.setFullName('张三')
    })
    let res!: { needsEmailConfirmation: boolean }
    await act(async () => {
      res = await result.current.handleSubmit()
    })
    expect(authMock.signUp).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'password123',
      options: { data: { full_name: '张三' } },
    })
    expect(routeAfterLoginMock).toHaveBeenCalled()
    expect(res.needsEmailConfirmation).toBe(false)
  })

  it('注册成功但需邮箱验证（无会话）：返回 needsEmailConfirmation 且不路由', async () => {
    authMock.signUp.mockResolvedValue({
      data: { session: null, user: { id: 'u2' } },
      error: null,
    })
    const { result } = renderHook(() => useSignup())
    act(() => {
      result.current.setEmail('a@b.com')
      result.current.setPassword('password123')
      result.current.setConfirmPassword('password123')
      result.current.setFullName('张三')
    })
    let res!: { needsEmailConfirmation: boolean }
    await act(async () => {
      res = await result.current.handleSubmit()
    })
    expect(res.needsEmailConfirmation).toBe(true)
    expect(routeAfterLoginMock).not.toHaveBeenCalled()
  })

  it('signUp 报错：归一化文案展示', async () => {
    authMock.signUp.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'User already registered' },
    })
    const { result } = renderHook(() => useSignup())
    act(() => {
      result.current.setEmail('a@b.com')
      result.current.setPassword('password123')
      result.current.setConfirmPassword('password123')
      result.current.setFullName('张三')
    })
    let res!: { needsEmailConfirmation: boolean }
    await act(async () => {
      res = await result.current.handleSubmit()
    })
    expect(result.current.errorMsg).toBe('该邮箱已被注册，请直接登录')
    expect(res.needsEmailConfirmation).toBe(false)
  })
})
