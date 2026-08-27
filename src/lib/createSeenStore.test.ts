import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSeenStore } from './createSeenStore'

const { storage } = vi.hoisted(() => ({ storage: new Map<string, unknown>() }))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: (k: string) => storage.get(k) ?? '',
    setStorageSync: (k: string, v: unknown) => {
      storage.set(k, v)
    },
  },
}))

describe('createSeenStore（P2-4 已读/红点工厂，postSeen/rehearsalSeen 共用）', () => {
  beforeEach(() => storage.clear())
  afterEach(() => storage.clear())

  it('markSeen 后 isSeen 为 true（postSeen 标记生效）', () => {
    const store = createSeenStore('postSeen_')
    expect(store.isSeen(1)).toBe(false)
    store.markSeen(1)
    expect(store.isSeen(1)).toBe(true)
    expect(store.isSeen(2)).toBe(false)
  })

  it('markSeen 广播给已订阅者，退订后停止', () => {
    const store = createSeenStore('postSeen_')
    const cb = vi.fn()
    const unsub = store.subscribeSeen(cb)
    store.markSeen('a')
    expect(cb).toHaveBeenCalledTimes(1)
    unsub()
    store.markSeen('b')
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('notify 手动触发已读广播', () => {
    const store = createSeenStore('postSeen_')
    const cb = vi.fn()
    store.subscribeSeen(cb)
    store.notify()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('未查看红点 flag：setUnviewedFlag 仅在变化时广播', () => {
    const store = createSeenStore('postSeen_')
    expect(store.getUnviewedFlag()).toBe(false)
    const cb = vi.fn()
    store.subscribeUnviewedFlag(cb)
    store.setUnviewedFlag(true)
    expect(store.getUnviewedFlag()).toBe(true)
    expect(cb).toHaveBeenCalledTimes(1)
    store.setUnviewedFlag(true) // 同值不重复广播
    expect(cb).toHaveBeenCalledTimes(1)
    store.setUnviewedFlag(false)
    expect(store.getUnviewedFlag()).toBe(false)
    expect(cb).toHaveBeenCalledTimes(2)
  })
})
