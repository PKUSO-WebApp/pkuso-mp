// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  establishSession,
  verifySession,
  getStoredSessionToken,
  clearSessionToken,
} from './single-session'

// 内存版 Taro 存储，模拟小程序本地持久化
const { taroMock, store } = vi.hoisted(() => {
  const localStore: Record<string, string> = {}
  const mock = {
    getStorageSync: vi.fn((k: string) => (k in localStore ? localStore[k] : '')),
    setStorageSync: vi.fn((k: string, v: string) => {
      localStore[k] = v
    }),
    removeStorageSync: vi.fn((k: string) => {
      delete localStore[k]
    }),
  }
  return { taroMock: mock, store: localStore }
})
// 默认导入（single-session 的 import Taro from '@tarojs/taro'）与命名导入同源
vi.mock('@tarojs/taro', () => ({ ...taroMock, default: taroMock }))

const rpcMock = vi.fn()
const client: any = { rpc: rpcMock }

beforeEach(() => {
  rpcMock.mockReset()
  Object.keys(store).forEach((k) => delete store[k])
})

describe('single-session', () => {
  it('establishSession 写入本地令牌并返回', async () => {
    rpcMock.mockResolvedValue({
      data: [{ session_token: 'tok-1', session_started_at: '2026-08-22T10:00:00Z' }],
      error: null,
    })
    const res = await establishSession(client)
    expect(res).toEqual({ token: 'tok-1', startedAt: '2026-08-22T10:00:00Z' })
    expect(getStoredSessionToken()).toBe('tok-1')
    expect(rpcMock).toHaveBeenCalledWith('touch_session')
  })

  it('establishSession 查询失败返回 null 且不写本地', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const res = await establishSession(client)
    expect(res).toBeNull()
    expect(getStoredSessionToken()).toBeNull()
  })

  it('verifySession 本地无令牌时不判踢（避免误伤）', async () => {
    rpcMock.mockResolvedValue({
      data: [{ session_token: 'other', session_started_at: '2026-08-22T11:00:00Z' }],
      error: null,
    })
    const res = await verifySession(client)
    expect(res).toEqual({ kicked: false, startedAt: null })
  })

  it('verifySession DB 令牌与本地不一致 → 被挤下线，附登录时刻', async () => {
    store['pkuso_single_session_token'] = 'mine'
    rpcMock.mockResolvedValue({
      data: [{ session_token: 'other', session_started_at: '2026-08-22T11:00:00Z' }],
      error: null,
    })
    const res = await verifySession(client)
    expect(res).toEqual({ kicked: true, startedAt: '2026-08-22T11:00:00Z' })
  })

  it('verifySession DB 与本地一致 → 未被踢', async () => {
    store['pkuso_single_session_token'] = 'mine'
    rpcMock.mockResolvedValue({
      data: [{ session_token: 'mine', session_started_at: '2026-08-22T11:00:00Z' }],
      error: null,
    })
    const res = await verifySession(client)
    expect(res).toEqual({ kicked: false, startedAt: null })
  })

  it('verifySession 查询失败保守判为未踢', async () => {
    store['pkuso_single_session_token'] = 'mine'
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const res = await verifySession(client)
    expect(res).toEqual({ kicked: false, startedAt: null })
  })

  it('clearSessionToken 清空本地令牌', async () => {
    store['pkuso_single_session_token'] = 'mine'
    clearSessionToken()
    expect(getStoredSessionToken()).toBeNull()
  })
})
