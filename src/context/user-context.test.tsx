// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UserProvider, useUser } from './user-context'

// hoisted mock：测试中直接改写 auth 行为
const { authMock } = vi.hoisted(() => ({
  authMock: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
  },
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: authMock },
}))

const makeSession = (userId: string) => ({
  access_token: 'token',
  refresh_token: 'refresh',
  expires_in: 3600,
  expires_at: 9999999999,
  token_type: 'bearer',
  user: {
    id: userId,
    email: `${userId}@example.com`,
    email_confirmed_at: '2024-01-01T00:00:00Z',
  },
})

const stubSubscription = { data: { subscription: { unsubscribe: vi.fn() } } }

function renderWithProvider() {
  return renderHook(() => useUser(), { wrapper: UserProvider })
}

describe('UserProvider', () => {
  beforeEach(() => {
    authMock.getSession.mockReset()
    authMock.onAuthStateChange.mockReset()
    authMock.getSession.mockResolvedValue({ data: { session: null }, error: null })
    authMock.onAuthStateChange.mockReturnValue(stubSubscription)
  })

  afterEach(() => {
    cleanup()
  })

  it('getSession 恢复会话后 ready 为 true 且 user 可见', async () => {
    authMock.getSession.mockResolvedValue({ data: { session: makeSession('u1') }, error: null })
    const { result } = renderWithProvider()
    // 恢复完成前 ready 为 false
    expect(result.current.ready).toBe(false)
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.user?.id).toBe('u1')
    expect(result.current.user?.email).toBe('u1@example.com')
    expect(result.current.user?.emailConfirmed).toBe(true)
    expect(result.current.session).not.toBeNull()
  })

  it('无会话时 user 为 null', async () => {
    const { result } = renderWithProvider()
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.user).toBeNull()
    expect(result.current.session).toBeNull()
  })

  it('会话恢复完成前 ready 保持 false（避免登录页闪烁）', async () => {
    let resolveSession!: (value: unknown) => void
    authMock.getSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve
      })
    )
    const { result } = renderWithProvider()
    expect(result.current.ready).toBe(false)
    act(() => {
      resolveSession({ data: { session: null }, error: null })
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
  })

  it('onAuthStateChange 登录事件同步 session', async () => {
    let onChangeCb: ((event: string, session: unknown) => void) | undefined
    authMock.onAuthStateChange.mockImplementation((cb: (e: string, s: unknown) => void) => {
      onChangeCb = cb
      return stubSubscription
    })
    const { result } = renderWithProvider()
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => {
      onChangeCb?.('SIGNED_IN', makeSession('u2'))
    })
    expect(result.current.user?.id).toBe('u2')
  })

  it('onAuthStateChange 登出事件清空 session', async () => {
    authMock.getSession.mockResolvedValue({ data: { session: makeSession('u1') }, error: null })
    let onChangeCb: ((event: string, session: unknown) => void) | undefined
    authMock.onAuthStateChange.mockImplementation((cb: (e: string, s: unknown) => void) => {
      onChangeCb = cb
      return stubSubscription
    })
    const { result } = renderWithProvider()
    await waitFor(() => expect(result.current.user?.id).toBe('u1'))
    act(() => {
      onChangeCb?.('SIGNED_OUT', null)
    })
    expect(result.current.user).toBeNull()
    expect(result.current.session).toBeNull()
  })

  it('组件卸载时取消订阅', () => {
    const unsubscribe = vi.fn()
    authMock.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } })
    const { unmount } = renderWithProvider()
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('事件先于 getSession resolve：以事件为准，慢查询结果不覆盖已登录状态', async () => {
    let resolveSession!: (value: unknown) => void
    authMock.getSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve
      })
    )
    let onChangeCb!: (event: string, session: unknown) => void
    authMock.onAuthStateChange.mockImplementation((cb: (e: string, s: unknown) => void) => {
      onChangeCb = cb
      return stubSubscription
    })
    const { result } = renderWithProvider()
    // SDK 真实时序：订阅后 INITIAL_SESSION 事件先行
    act(() => {
      onChangeCb('SIGNED_IN', makeSession('u2'))
    })
    expect(result.current.user?.id).toBe('u2')
    // getSession 后到且返回 null（storage 与事件不一致的极端场景），不得把已登录回退
    act(() => {
      resolveSession({ data: { session: null }, error: null })
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.user?.id).toBe('u2')
    expect(result.current.restoreFailed).toBe(false)
  })

  it('getSession 超时降级：10s 后 ready 为 true 且 restoreFailed 为 true', async () => {
    vi.useFakeTimers()
    try {
      // 永不 settle 的 getSession，模拟弱网挂起
      authMock.getSession.mockReturnValue(new Promise(() => {}))
      const { result } = renderWithProvider()
      expect(result.current.ready).toBe(false)
      await act(async () => {
        vi.advanceTimersByTime(9999)
      })
      expect(result.current.ready).toBe(false)
      await act(async () => {
        vi.advanceTimersByTime(1)
      })
      expect(result.current.ready).toBe(true)
      expect(result.current.restoreFailed).toBe(true)
      expect(result.current.user).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('getSession 异常（reject）也降级：ready 为 true 且 restoreFailed 为 true', async () => {
    authMock.getSession.mockRejectedValue(new Error('network down'))
    const { result } = renderWithProvider()
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.restoreFailed).toBe(true)
    expect(result.current.user).toBeNull()
  })

  it('useUser 在 Provider 外抛错', () => {
    expect(() => renderHook(() => useUser())).toThrow('useUser 必须在 UserProvider 内部使用')
  })
})
