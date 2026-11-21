// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMemberReactions, REACTION_FLUSH_DELAY_MS } from '../useMemberReactions'

const { rpcMock, cache, notifyMock, taroMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  cache: new Map<string, any[]>(),
  notifyMock: vi.fn(),
  taroMock: { showToast: vi.fn(), onAppHide: vi.fn(), offAppHide: vi.fn() },
}))

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: rpcMock } }))
vi.mock('@/hooks/useProfiles', () => ({
  singleUserCache: cache,
  notifySingleUserCacheChange: notifyMock,
}))
vi.mock('@tarojs/taro', () => ({ default: taroMock }))
vi.mock('@/i18n', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'zh-CN', setLocale: vi.fn() }),
}))

const renderReactions = () =>
  renderHook(() =>
    useMemberReactions({
      targetUserId: 'u1',
      initialLikes: 10,
      initialFlowers: 20,
    })
  )

describe('useMemberReactions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    rpcMock.mockReset()
    cache.clear()
    notifyMock.mockReset()
    taroMock.showToast.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('连续点击合并成一次 RPC；成功后用服务端绝对值校准', async () => {
    cache.set('u1', [{ id: 'u1', likes_count: 10, flowers_count: 20 }])
    rpcMock.mockResolvedValue({ data: { ok: true, likes: 13, flowers: 22 }, error: null })
    const { result } = renderReactions()

    act(() => {
      result.current.bump('likes')
      result.current.bump('likes')
      result.current.bump('likes')
      result.current.bump('flowers')
      result.current.bump('flowers')
    })

    // 本地立即 +1（10 + 3 / 20 + 2）
    expect(result.current.likes).toBe(13)
    expect(result.current.flowers).toBe(22)

    await act(async () => {
      vi.advanceTimersByTime(REACTION_FLUSH_DELAY_MS - 1)
    })
    expect(rpcMock).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
    })
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('add_member_reactions', {
      p_target_user_id: 'u1',
      p_likes: 3,
      p_flowers: 2,
    })
    expect(result.current.likes).toBe(13)
    expect(result.current.flowers).toBe(22)
    expect(cache.get('u1')?.[0]).toMatchObject({ likes_count: 13, flowers_count: 22 })
    expect(notifyMock).toHaveBeenCalledWith('u1')
  })

  it('RPC 飞行期间的新点击不丢、不闪回，随后单独再发一批', async () => {
    let resolveRpc!: (value: unknown) => void
    rpcMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRpc = resolve
      })
    )
    const { result } = renderReactions()

    act(() => result.current.bump('likes'))
    await act(async () => {
      vi.advanceTimersByTime(REACTION_FLUSH_DELAY_MS)
    })
    expect(rpcMock).toHaveBeenCalledTimes(1)

    // 第一批还在飞的时候再点一下
    act(() => result.current.bump('likes'))
    expect(result.current.likes).toBe(12)

    await act(async () => {
      resolveRpc({ data: { ok: true, likes: 11, flowers: 20 }, error: null })
      await Promise.resolve()
    })
    // confirmed=11 + 飞行期间新增的 1 = 12
    expect(result.current.likes).toBe(12)

    await act(async () => {
      vi.advanceTimersByTime(REACTION_FLUSH_DELAY_MS)
      await Promise.resolve()
    })
    expect(rpcMock).toHaveBeenCalledTimes(2)
    expect(rpcMock.mock.calls[1]?.[1]).toMatchObject({ p_likes: 1 })
  })

  it('失败时保留本地计数并退避重试', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const { result } = renderReactions()

    act(() => result.current.bump('likes'))
    await act(async () => {
      vi.advanceTimersByTime(REACTION_FLUSH_DELAY_MS)
      await Promise.resolve()
    })
    expect(rpcMock).toHaveBeenCalledTimes(1)
    // 失败不能把刚点掉的那一下吞掉
    expect(result.current.likes).toBe(11)

    await act(async () => {
      vi.advanceTimersByTime(REACTION_FLUSH_DELAY_MS * 2)
      await Promise.resolve()
    })
    expect(rpcMock).toHaveBeenCalledTimes(2)
  })

  it('单批最多带 100，剩余的下批继续发', async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, likes: 110, flowers: 20 }, error: null })
    const { result } = renderReactions()

    act(() => {
      for (let i = 0; i < 101; i += 1) result.current.bump('likes')
    })
    expect(result.current.likes).toBe(111)

    await act(async () => {
      vi.advanceTimersByTime(REACTION_FLUSH_DELAY_MS)
      await Promise.resolve()
    })
    expect(rpcMock.mock.calls[0]?.[1]).toMatchObject({ p_likes: 100 })
    expect(result.current.likes).toBe(111)

    await act(async () => {
      vi.advanceTimersByTime(REACTION_FLUSH_DELAY_MS)
      await Promise.resolve()
    })
    expect(rpcMock.mock.calls[1]?.[1]).toMatchObject({ p_likes: 1 })
  })

  it('卸载时立即补发，不等 1.5s 定时器', () => {
    rpcMock.mockResolvedValue({ data: { ok: true, likes: 11, flowers: 20 }, error: null })
    const { result, unmount } = renderReactions()

    act(() => result.current.bump('likes'))
    unmount()

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock.mock.calls[0]?.[1]).toMatchObject({ p_likes: 1 })
  })
})
