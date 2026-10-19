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
    getDeviceInfo: vi.fn(() => ({ model: 'iPhone 13', system: 'iOS 17.0', platform: 'ios' })),
    // 仅保留最新回调（模拟真实 Taro 行为），便于测试触发前台检测
    useDidShow: vi.fn((cb: () => void) => {
      localDidShowCbs.length = 0
      localDidShowCbs.push(cb)
    }),
    reLaunch: vi.fn().mockResolvedValue({}),
  }
  return { taroMock: localTaroMock, store: localStore, didShowCbs: localDidShowCbs }
})

// 默认导入（device-session / device-id 的 import Taro from '@tarojs/taro'）与命名导入同源
vi.mock('@tarojs/taro', () => ({ ...taroMock, default: taroMock }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: authMock, rpc: supabaseRpcMock } }))
vi.mock('@tarojs/components', () => {
  const create = (tag: string) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span'), Button: create('button') }
})

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
    // 默认：touch_session_v2 登记本机这一行（trusted）；自查返回空行（= 没被踢）
    supabaseRpcMock.mockImplementation((fn: string) => {
      if (fn === 'touch_session_v2') {
        return Promise.resolve({ data: [{ token: 't-local', trusted: true }], error: null })
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

  it('恢复失败后 retryRestore 成功：user 回填、restoreFailed 复位', async () => {
    authMock.getSession.mockRejectedValueOnce(new Error('network down'))
    const { result } = renderWithProvider()
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.restoreFailed).toBe(true)

    authMock.getSession.mockResolvedValueOnce({
      data: { session: makeSession('u1') },
      error: null,
    })
    await act(() => result.current.retryRestore())

    expect(result.current.user?.id).toBe('u1')
    expect(result.current.restoreFailed).toBe(false)
  })

  it('retryRestore 仍然失败：restoreFailed 保持，不清掉可能有效的本地会话', async () => {
    authMock.getSession.mockRejectedValueOnce(new Error('network down'))
    const { result } = renderWithProvider()
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.restoreFailed).toBe(true)

    authMock.getSession.mockRejectedValueOnce(new Error('still down'))
    await act(() => result.current.retryRestore())

    expect(result.current.restoreFailed).toBe(true)
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

  it('恢复会话后调用 touch_session_v2 登记本设备这一行（带 device_id / 名称 / 平台）', async () => {
    authMock.getSession.mockResolvedValue({ data: { session: makeSession('u1') }, error: null })
    const { result } = renderWithProvider()
    await waitFor(() => expect(result.current.user?.id).toBe('u1'))
    expect(supabaseRpcMock).toHaveBeenCalledWith('touch_session_v2', {
      p_device_id: expect.stringMatching(/^[a-z0-9]{8,64}$/),
      p_name: 'iPhone 13 · iOS 17.0',
      p_platform: 'ios',
    })
    // 本机 device_id 已写入本地（设备列表据此标出「本机」）
    await waitFor(() =>
      expect(taroMock.setStorageSync).toHaveBeenCalledWith('pkuso_device_id', expect.any(String))
    )
  })

  it('本设备被设为不信任：前台自查 trusted=false → 强制下线通知 + 清会话 + 本地登出', async () => {
    authMock.getSession.mockResolvedValue({ data: { session: makeSession('u1') }, error: null })
    supabaseRpcMock.mockImplementation((fn: string) => {
      if (fn === 'touch_session_v2') {
        return Promise.resolve({ data: [{ token: 't-local', trusted: true }], error: null })
      }
      if (fn === 'get_my_session_v2') {
        // 另一台设备把本机设为不信任：行还在，trusted 变 false
        return Promise.resolve({
          data: [{ token: 't-local', trusted: false, last_seen_at: '2026-10-13T10:00:00Z' }],
          error: null,
        })
      }
      return Promise.resolve({ data: [], error: null })
    })
    const { result } = renderWithProvider()
    await waitFor(() => expect(result.current.user?.id).toBe('u1'))
    // 等 touch 完成（establishing 期间自查会早退）
    await waitFor(() =>
      expect(supabaseRpcMock).toHaveBeenCalledWith('touch_session_v2', expect.anything())
    )
    await act(async () => {})
    // 触发前台检测（本机回到前台）
    await act(async () => {
      didShowCbs[didShowCbs.length - 1]()
    })
    await waitFor(() => expect(result.current.forcedOffline).toBe(true))
    expect(supabaseRpcMock).toHaveBeenCalledWith('get_my_session_v2', expect.anything())
    // applySession(null) 延迟到 reLaunch 完成后执行，故 session/user 需等待
    await waitFor(() => {
      expect(result.current.session).toBeNull()
      expect(result.current.user).toBeNull()
    })
    await waitFor(() => expect(authMock.signOut).toHaveBeenCalled())
    // 旧单设备令牌的残留被顺手清掉
    expect(taroMock.removeStorageSync).toHaveBeenCalledWith('pkuso_single_session_token')
  })

  it('冷启动时本设备已被拒绝登录：touch_session_v2 返回 device_rejected → 同样强制下线', async () => {
    authMock.getSession.mockResolvedValue({ data: { session: makeSession('u1') }, error: null })
    supabaseRpcMock.mockImplementation((fn: string) => {
      if (fn === 'touch_session_v2') {
        return Promise.resolve({ data: null, error: { message: 'device_rejected' } })
      }
      return Promise.resolve({ data: [], error: null })
    })
    const { result } = renderWithProvider()
    await waitFor(() => expect(result.current.forcedOffline).toBe(true))
    await waitFor(() => {
      expect(result.current.session).toBeNull()
      expect(result.current.user).toBeNull()
    })
    await waitFor(() => expect(authMock.signOut).toHaveBeenCalled())
    // device_rejected 只可能来自「不信任且未删除」⇒ 弹窗出「被拒绝登录」那套文案
    expect(result.current.forcedOfflineKind).toBe('rejected')
  })

  it('自查发现本设备被「删除设备」（deleted_at 非空）⇒ 同样下线，但 kind 为 deleted', async () => {
    authMock.getSession.mockResolvedValue({ data: { session: makeSession('u1') }, error: null })
    supabaseRpcMock.mockImplementation((fn: string) => {
      if (fn === 'touch_session_v2') {
        return Promise.resolve({ data: [{ token: 't-local', trusted: true }], error: null })
      }
      if (fn === 'get_my_session_v2') {
        // 别的设备把本机删掉了：行还在（墓碑），trusted = false 且 deleted_at 非空
        return Promise.resolve({
          data: [
            {
              token: 't-local',
              trusted: false,
              deleted_at: '2026-10-14T02:00:00Z',
              last_seen_at: '2026-10-14T01:00:00Z',
            },
          ],
          error: null,
        })
      }
      return Promise.resolve({ data: [], error: null })
    })
    const { result } = renderWithProvider()
    await waitFor(() => expect(result.current.user?.id).toBe('u1'))
    // 等 touch 完成（establishing 期间自查会早退）
    await waitFor(() =>
      expect(supabaseRpcMock).toHaveBeenCalledWith('touch_session_v2', expect.anything())
    )
    await act(async () => {})
    await act(async () => {
      didShowCbs[didShowCbs.length - 1]()
    })
    await waitFor(() => expect(result.current.forcedOffline).toBe(true))
    expect(result.current.forcedOfflineKind).toBe('deleted')
    expect(supabaseRpcMock).toHaveBeenCalledWith('get_my_session_v2', expect.anything())
  })

  it('自查查不到行（换了 device_id / 新装机）不算被踢，会话保留', async () => {
    authMock.getSession.mockResolvedValue({ data: { session: makeSession('u1') }, error: null })
    const { result } = renderWithProvider()
    await waitFor(() => expect(result.current.user?.id).toBe('u1'))
    await act(async () => {
      didShowCbs[didShowCbs.length - 1]()
    })
    expect(result.current.forcedOffline).toBe(false)
    // 没被踢 ⇒ 也没有「被踢的原因」（弹窗按 kind 选文案，留个残值会张冠李戴）
    expect(result.current.forcedOfflineKind).toBeNull()
    expect(result.current.user?.id).toBe('u1')
  })
})
