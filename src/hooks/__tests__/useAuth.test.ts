// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserContextValue } from '@/context/user-context'
import { useAuth } from '../useAuth'

// 可变的 useUser mock：改写状态后 rerender 即可读到最新值
const { ctx } = vi.hoisted(() => {
  const state: UserContextValue = { session: null, user: null, ready: false, restoreFailed: false }
  return { ctx: state }
})

vi.mock('@/context/user-context', () => ({
  useUser: () => ctx,
}))

const { authMock } = vi.hoisted(() => ({
  authMock: {
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
  },
}))

// 模块加载即校验环境变量，直接 mock 掉 supabase 模块
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: authMock },
}))

describe('useAuth', () => {
  const client = { auth: authMock } as never

  beforeEach(() => {
    authMock.signInWithPassword.mockReset()
    authMock.signOut.mockReset()
    authMock.signInWithPassword.mockResolvedValue({ data: { session: null }, error: null })
    authMock.signOut.mockResolvedValue({ error: null })
    ctx.session = null
    ctx.user = null
    ctx.ready = false
    ctx.restoreFailed = false
  })

  afterEach(() => {
    cleanup()
  })

  it('会话恢复完成前 loading 为 true', () => {
    const { result } = renderHook(() => useAuth(client))
    expect(result.current.loading).toBe(true)
    expect(result.current.ready).toBe(false)
  })

  it('会话状态透传（session/user/ready）', () => {
    ctx.session = {} as UserContextValue['session']
    ctx.user = { id: 'u1', email: 'a@b.com', emailConfirmed: true }
    ctx.ready = true
    const { result, rerender } = renderHook(() => useAuth(client))
    // 手动重新渲染读取最新 ctx
    rerender()
    expect(result.current.ready).toBe(true)
    expect(result.current.loading).toBe(false)
    expect(result.current.user?.id).toBe('u1')
    expect(result.current.user?.email).toBe('a@b.com')
  })

  it('signIn 成功：携带邮箱密码调用并清除 error', async () => {
    const { result } = renderHook(() => useAuth(client))
    let res: { error: { message: string } | null } | undefined
    await act(async () => {
      res = await result.current.signIn(' a@b.com ', 'pw')
    })
    expect(authMock.signInWithPassword).toHaveBeenCalledWith({ email: ' a@b.com ', password: 'pw' })
    expect(res?.error).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('signIn 失败：error 状态与返回值均带 message', async () => {
    authMock.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: '密码错误' },
    })
    const { result } = renderHook(() => useAuth(client))
    let res!: { error: { message: string } | null }
    await act(async () => {
      res = await result.current.signIn('a@b.com', 'bad')
    })
    expect(res.error?.message).toBe('密码错误')
    expect(result.current.error).toBe('密码错误')
  })

  it('signOut 调用 client.auth.signOut', async () => {
    const { result } = renderHook(() => useAuth(client))
    await act(async () => {
      await result.current.signOut()
    })
    expect(authMock.signOut).toHaveBeenCalled()
  })
})
