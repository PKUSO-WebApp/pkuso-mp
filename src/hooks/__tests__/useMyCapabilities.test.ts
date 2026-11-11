// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetMyCapabilitiesCache,
  myCapabilitiesStorageKey,
  useMyCapabilities,
} from '../useMyCapabilities'

const h = vi.hoisted(() => {
  const storage = new Map<string, string>()
  const showCallbacks: Array<() => void> = []
  const taroMock = {
    getStorageSync: vi.fn((key: string) => storage.get(key) ?? ''),
    setStorageSync: vi.fn((key: string, value: string) => {
      storage.set(key, value)
    }),
    useDidShow: vi.fn((cb: () => void) => {
      showCallbacks.push(cb)
    }),
  }
  return {
    storage,
    showCallbacks,
    taroMock,
    user: { id: 'user-1' } as { id: string } | null,
  }
})

vi.mock('@tarojs/taro', () => ({
  default: h.taroMock,
  useDidShow: h.taroMock.useDidShow,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {},
}))

vi.mock('@/context/user-context', () => ({
  useUser: () => ({ user: h.user }),
}))

type RpcResult = {
  data: string[] | null
  error: { message: string } | null
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function renderCapabilities(rpc: ReturnType<typeof vi.fn>) {
  const client = { rpc } as never
  return renderHook(() => useMyCapabilities(client))
}

describe('useMyCapabilities', () => {
  beforeEach(() => {
    __resetMyCapabilitiesCache()
    h.storage.clear()
    h.showCallbacks.length = 0
    h.user = { id: 'user-1' }
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('首帧直接使用缓存，不等待 RPC', async () => {
    h.storage.set(myCapabilitiesStorageKey('user-1'), JSON.stringify(['leave_approval']))
    const pending = deferred<RpcResult>()
    const rpc = vi.fn(() => pending.promise)

    const { result } = renderCapabilities(rpc)

    expect(result.current.capabilities).toEqual(['leave_approval'])
    expect(result.current.loading).toBe(false)
    expect(result.current.hasCapability('leave_approval')).toBe(true)
    expect(result.current.hasCapability('attendance')).toBe(false)

    await act(async () => {
      pending.resolve({ data: ['leave_approval'], error: null })
      await pending.promise
    })
  })

  it('无缓存时 loading，成功后写入缓存并过滤未知能力', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: ['attendance', 'not_a_capability', 'leave_approval'],
      error: null,
    })

    const { result } = renderCapabilities(rpc)

    expect(result.current.loading).toBe(true)
    expect(result.current.capabilities).toEqual([])

    await waitFor(() => {
      expect(result.current.capabilities).toEqual(['leave_approval', 'attendance'])
    })
    expect(result.current.loading).toBe(false)
    expect(JSON.parse(h.storage.get(myCapabilitiesStorageKey('user-1')) ?? '[]')).toEqual([
      'leave_approval',
      'attendance',
    ])
  })

  it('包含第七项 announcement，并按固定顺序输出', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: ['attendance_export', 'announcement', 'rehearsal'],
      error: null,
    })

    const { result } = renderCapabilities(rpc)

    await waitFor(() => {
      expect(result.current.capabilities).toEqual([
        'rehearsal',
        'announcement',
        'attendance_export',
      ])
    })
    expect(result.current.hasCapability('announcement')).toBe(true)
  })

  it('RPC 失败时保留已有缓存，不把入口清空', async () => {
    h.storage.set(myCapabilitiesStorageKey('user-1'), JSON.stringify(['attendance_export']))
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'network down' },
    })

    const { result } = renderCapabilities(rpc)

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
    expect(result.current.capabilities).toEqual(['attendance_export'])
    expect(result.current.loading).toBe(false)
  })

  it('无缓存且请求失败时结束 loading，入口保持隐藏', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'network down' },
    })

    const { result } = renderCapabilities(rpc)

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.capabilities).toEqual([])
  })

  it('缓存按账号隔离，换账号不会读到上一个人的能力', async () => {
    h.storage.set(myCapabilitiesStorageKey('user-1'), JSON.stringify(['leave_approval']))
    h.storage.set(myCapabilitiesStorageKey('user-2'), JSON.stringify(['attendance_export']))
    // 让刷新失败，确保断言只来自各自账号的缓存
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'offline' },
    })

    const { result, rerender } = renderCapabilities(rpc)
    expect(result.current.capabilities).toEqual(['leave_approval'])

    h.user = { id: 'user-2' }
    rerender()

    await waitFor(() => {
      expect(result.current.capabilities).toEqual(['attendance_export'])
    })
  })

  it('页面展示时静默刷新一次', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null })

    renderCapabilities(rpc)
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))

    const show = h.showCallbacks[h.showCallbacks.length - 1]
    expect(show).toBeTypeOf('function')
    act(() => show())

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2))
  })
})
