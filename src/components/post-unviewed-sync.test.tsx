// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import {
  getPostUnviewedFlag,
  setPostUnviewedFlag,
  isCommunityDotOn,
} from '@/lib/postSeen'
import { PostUnviewedSync } from './post-unviewed-sync'

const postMock = vi.hoisted(() => ({ data: [] as any[], fetch: vi.fn() }))
const userMock = vi.hoisted(() => ({ user: { id: 'u1' }, ready: true }))
const taroStore = vi.hoisted(() => new Map<string, unknown>())

vi.mock('@tarojs/taro', () => ({
  default: {
    useDidShow: vi.fn(),
    getStorageSync: (k: string) => taroStore.get(k),
    setStorageSync: (k: string, v: unknown) => {
      taroStore.set(k, v)
    },
  },
  useDidShow: vi.fn(),
}))
vi.mock('@/hooks/usePosts', () => ({ usePosts: () => ({ data: postMock.data, fetch: postMock.fetch }) }))
vi.mock('@/context/user-context', () => ({ useUser: () => ({ user: userMock.user, ready: userMock.ready }) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  // 复位模块级红点 store 与存储桩，避免用例间串扰
  setPostUnviewedFlag(false)
  taroStore.clear()
})

describe('PostUnviewedSync 社区底边栏红点（点击即消 / 新帖再亮）', () => {
  it('最新公告晚于上次点击消除时间 → 点亮', () => {
    taroStore.set('communityBarDismissedAt', 1000)
    postMock.data = [{ id: '1', created_at: '2026-01-02T00:00:00' }]
    render(<PostUnviewedSync />)
    expect(getPostUnviewedFlag()).toBe(true)
  })

  it('消除时间晚于最新公告（已点击社区）→ 熄灭', () => {
    taroStore.set('communityBarDismissedAt', Date.now() + 10_000)
    postMock.data = [{ id: '1', created_at: '2026-08-20T10:00:00' }]
    render(<PostUnviewedSync />)
    expect(getPostUnviewedFlag()).toBe(false)
  })

  it('无公告不点亮', () => {
    taroStore.set('communityBarDismissedAt', 1000)
    postMock.data = []
    render(<PostUnviewedSync />)
    expect(getPostUnviewedFlag()).toBe(false)
  })

  it('从未点击过（无消除记录，缺省按 0）→ 有公告即点亮', () => {
    postMock.data = [{ id: '1', created_at: '2026-08-20T10:00:00' }]
    render(<PostUnviewedSync />)
    expect(getPostUnviewedFlag()).toBe(true)
  })

  it('isCommunityDotOn：缺时间戳（未播种/无内容）一律不亮', () => {
    expect(isCommunityDotOn(5000, null)).toBe(false)
    expect(isCommunityDotOn(null, 1000)).toBe(false)
    expect(isCommunityDotOn(1000, 2000)).toBe(false)
    expect(isCommunityDotOn(3000, 2000)).toBe(true)
  })

  it('会话就绪即重新拉取帖子（修正冷启动空结果）', () => {
    render(<PostUnviewedSync />)
    expect(postMock.fetch).toHaveBeenCalled()
  })
})
