// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { getPostUnviewedFlag, setPostUnviewedFlag } from '@/lib/postSeen'
import { PostUnviewedSync } from './post-unviewed-sync'

const postMock = vi.hoisted(() => ({ data: [] as any[], fetch: vi.fn() }))
const userMock = vi.hoisted(() => ({ user: { id: 'u1' }, ready: true }))

vi.mock('@tarojs/taro', () => ({ default: { useDidShow: vi.fn() }, useDidShow: vi.fn() }))
vi.mock('@/hooks/usePosts', () => ({ usePosts: () => ({ data: postMock.data, fetch: postMock.fetch }) }))
vi.mock('@/context/user-context', () => ({ useUser: () => ({ user: userMock.user, ready: userMock.ready }) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  // 复位模块级红点 store，避免用例间串扰
  setPostUnviewedFlag(false)
})

describe('PostUnviewedSync 社区红点', () => {
  it('存在未查看帖子时点亮社区 tab 红点（冷启动进入小程序即判断）', () => {
    postMock.data = [{ id: '1', is_locked: false }]
    render(<PostUnviewedSync />)
    expect(getPostUnviewedFlag()).toBe(true)
  })

  it('全部已读时红点熄灭', () => {
    postMock.data = []
    render(<PostUnviewedSync />)
    expect(getPostUnviewedFlag()).toBe(false)
  })

  it('会话就绪即重新拉取帖子（修正冷启动空结果）', () => {
    render(<PostUnviewedSync />)
    expect(postMock.fetch).toHaveBeenCalled()
  })
})
