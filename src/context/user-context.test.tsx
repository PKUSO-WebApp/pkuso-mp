// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UserProvider, useUser } from './user-context'

// hoisted mock：测试中直接改写 auth / rpc / Taro 行为
const { authMock, supabaseRpcMock } = vi.hoisted(() => ({
  authMock: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signOut: vi.fn(),
  },
  supabaseRpcMock: vi.fn(),
}))

const { taroMock, store, didShowCbs } = vi.hoisted(() => {
  const localStore: Record<string, string> = {}
  const localDidShowCbs: Array<() => void> = []
  const localTaroMock = {
    getStorageSync: vi.fn((k: string) => (k in localStore ? localStore[k] : '')),
    setStorageSync: vi.fn((k: string, v: string) => {
      localStore[k] = v
    }),
    removeStorageSync: vi.fn((k: string) => {
      delete localStore[k]
    }),
    // 仅保留最新回调（模拟真实 Taro 行为），便于测试触发前台检测
    useDidShow: vi.fn((cb: () => void) => {
      localDidShowCbs.length = 0
      localDidShowCbs.push(cb)
    }),
    reLaunch: vi.fn().mockResolvedValue({}),
  }
  return { taroMock: localTaroMock, store: localStore, didShowCbs: localDidShowCbs }
})

// 默认导入（single-session 的 import Taro from '@tarojs/taro'）与命名导入同源
vi.mock('@tarojs/taro', () => ({ ...taroMock, default: taroMock }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: authMock, rpc: supabaseRpcMock } }))
vi.mock('@tarojs/components', () => {
  const create = (tag: string) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return {
    View: create('div'),
    Text: create('span'),
    Button: create('button'),
    RootPortal: ({ children }: any) => React.createElement(React.Fragment, null, children),
  }
})
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ opened, children }: any) =>
    opened ? React.createElement('div', { 'data-testid': 'modal' }, children) : null,
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
    authMock.signOut.mockReset().mockResolvedValue({ error: null })
    supabaseRpcMock.mockReset()
    Object.keys(store).forEach((k) => delete store[k])
    didShowCbs.length = 0
    // 默认：touch_session 写入本机令牌；其余 RPC 返回空（不影响既有断言）
    supabaseRpcMock.mockImplementation((fn: string) => {
      if (fn === 'touch_session') {
        return Promise.resolve({
          data: [{ session_token: 't-local', session_started_at: '2026-08-22T10:00:00Z' }],
          error: null,
        })
      }
      return Promise.resolve({ data: [], error: null })
    })
    authMock.getSession.mockResolvedValue({ data: { session: null }, error: null })
    authMock.onAuthStateChange.mockReturnValue(stubSubscription)
  })

  afterEach(() => {
    cleanup()
  })

  it('getSession 恢复会话后 ready 为 true 且 user 可见', async () => {
    authMock.getSession.mockResolvedValue({ data: { session: makeSession('u1') }, error: null })
    const { result } = renderWithProvider()
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
    act(() => {
      onChangeCb('SIGNED_IN', makeSession('u2'))
    })
    expect(result.current.user?.id).toBe('u2')
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

  it('恢复会话后调用 touch_session 把本机登记为活跃会话', async () => {
    authMock.getSession.mockResolvedValue({ data: { session: makeSession('u1') }, error: null })
    const { result } = renderWithProvider()
    await waitFor(() => expect(result.current.user?.id).toBe('u1'))
    expect(supabaseRpcMock).toHaveBeenCalledWith('touch_session')
    // 本地令牌已写入，verify 比对基础成立
    await waitFor(() =>
      expect(taroMock.setStorageSync).toHaveBeenCalledWith('pkuso_single_session_token', 't-local')
    )
  })

  it('被其他设备挤下线：前台检测令牌不一致 → 弹窗 + 清会话 + 强制下线通知', async () => {
    authMock.getSession.mockResolvedValue({ data: { session: makeSession('u1') }, error: null })
    supabaseRpcMock.mockImplementation((fn: string) => {
      if (fn === 'touch_session') {
        return Promise.resolve({
          data: [{ session_token: 't-local', session_started_at: '2026-08-22T10:00:00Z' }],
          error: null,
        })
      }
      if (fn === 'get_my_session') {
        // 另一设备登录后 DB 令牌已变
        return Promise.resolve({
          data: [{ session_token: 't-other', session_started_at: '2026-08-22T11:00:00Z' }],
          error: null,
        })
      }
      return Promise.resolve({ data: [], error: null })
    })
    const { result } = renderWithProvider()
    await waitFor(() => expect(result.current.user?.id).toBe('u1'))
    // 确保本机令牌已落地（establishSession 异步写入）
    await waitFor(() =>
      expect(taroMock.setStorageSync).toHaveBeenCalledWith('pkuso_single_session_token', 't-local')
    )
    // 触发前台检测（设备 A 回到前台）
    await act(async () => {
      didShowCbs[didShowCbs.length - 1]()
    })
    await waitFor(() => expect(result.current.forcedOfflineAt).toBe('2026-08-22T11:00:00Z'))
    // applySession(null) 延迟到 reLaunch 完成后执行，故 session/user 需等待
    await waitFor(() => {
      expect(result.current.session).toBeNull()
      expect(result.current.user).toBeNull()
    })
    expect(supabaseRpcMock).toHaveBeenCalledWith('get_my_session')
    await waitFor(() => expect(authMock.signOut).toHaveBeenCalled())
  })
})
