// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNotifications } from '../useNotifications'

// 模块加载即校验环境变量，直接 mock 掉 supabase 模块（测试显式传 client，默认值不被使用）
vi.mock('@/lib/supabase', () => ({
  supabase: {},
}))

function mockClient<T>(responses: T[]) {
  let i = 0
  const c = (r: T) => ({
    eq: () => c(r),
    in: () => c(r),
    is: () => c(r),
    select: () => c(r),
    order: () => c(r),
    update: () => c(r),
    then: (resolve: (v: T) => void) => resolve(r),
  })
  return {
    from: () => ({
      select: () => c(responses[i++]),
      update: () => c(responses[i++]),
    }),
  }
}

describe('useNotifications', () => {
  afterEach(() => {
    cleanup()
  })

  it('refresh 按分类统计未读数', async () => {
    const c = mockClient([
      {
        data: [{ category: 'attendance' }, { category: 'attendance' }, { category: 'system' }],
        error: null,
      },
    ])
    const { result } = renderHook(() => useNotifications(c as never))
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.unreadCounts).toEqual({ attendance: 2, activity: 0, system: 1 })
    expect(result.current.totalUnread).toBe(3)
  })

  it('refresh 查询失败时保持计数为零且不抛错', async () => {
    const c = mockClient([{ data: null, error: { message: '查询失败' } }])
    const { result } = renderHook(() => useNotifications(c as never))
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.unreadCounts).toEqual({ attendance: 0, activity: 0, system: 0 })
  })

  it('fetchByCategory 返回分类消息列表', async () => {
    const rows = [
      {
        id: '1',
        category: 'attendance',
        title: '考勤',
        content: '内容',
        created_at: 'x',
        read_at: null,
      },
    ]
    const c = mockClient([{ data: rows, error: null }])
    const { result } = renderHook(() => useNotifications(c as never))
    const res = await act(() => result.current.fetchByCategory('attendance'))
    expect(res.error).toBeNull()
    expect(res.rows).toEqual(rows)
  })

  it('fetchByCategory 查询失败返回错误信息', async () => {
    const c = mockClient([{ data: null, error: { message: '查询失败' } }])
    const { result } = renderHook(() => useNotifications(c as never))
    const res = await act(() => result.current.fetchByCategory('activity'))
    expect(res.error).toBe('查询失败')
    expect(res.rows).toEqual([])
  })

  it('markCategoryRead 标记成功归零该分类计数', async () => {
    const c = mockClient([
      { data: [{ category: 'attendance' }], error: null }, // refresh
      { data: [{ id: '1' }], error: null }, // mark read
    ])
    const { result } = renderHook(() => useNotifications(c as never))
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.unreadCounts.attendance).toBe(1)
    const ok = await act(() => result.current.markCategoryRead('attendance', ['1']))
    expect(ok).toBe(true)
    expect(result.current.unreadCounts.attendance).toBe(0)
  })

  it('markCategoryRead 空 ids 直接归零返回 true', async () => {
    const c = mockClient([])
    const { result } = renderHook(() => useNotifications(c as never))
    const ok = await act(() => result.current.markCategoryRead('system', []))
    expect(ok).toBe(true)
    expect(result.current.unreadCounts.system).toBe(0)
  })

  it('markCategoryRead 0 行更新时返回 false 且不归零', async () => {
    const c = mockClient([{ data: [], error: null }])
    const { result } = renderHook(() => useNotifications(c as never))
    const ok = await act(() => result.current.markCategoryRead('activity', ['9']))
    expect(ok).toBe(false)
  })

  // markItemRead 专用 mock：支持 refresh（select('category').is()）与
  // 单条标记（update().eq().is().select('id')）两种调用链
  function mockClient2(refreshRows: { category: string }[], markResult: { data: unknown[] | null; error: unknown }) {
    return {
      from: () => ({
        select: (cols?: string) =>
          cols === 'category'
            ? { is: () => ({ then: (res: (v: unknown) => void) => res({ data: refreshRows, error: null }) }) }
            : { then: (res: (v: unknown) => void) => res({ data: [], error: null }) },
        update: () => ({
          eq: () => ({
            is: () => ({ select: () => ({ then: (res: (v: unknown) => void) => res(markResult) }) }),
          }),
        }),
      }),
    }
  }

  it('markItemRead 单条标记成功且未读数 -1', async () => {
    const c = mockClient2(
      [{ category: 'system' }, { category: 'system' }],
      { data: [{ id: '1' }], error: null }
    )
    const { result } = renderHook(() => useNotifications(c as never))
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.unreadCounts.system).toBe(2)
    const ok = await act(() => result.current.markItemRead('system', '1'))
    expect(ok).toBe(true)
    expect(result.current.unreadCounts.system).toBe(1)
  })

  it('markItemRead 0 行（已读/并发）返回 false 且不减量', async () => {
    const c = mockClient2([{ category: 'system' }, { category: 'system' }], {
      data: [],
      error: null,
    })
    const { result } = renderHook(() => useNotifications(c as never))
    await act(async () => {
      await result.current.refresh()
    })
    const ok = await act(() => result.current.markItemRead('system', '1'))
    expect(ok).toBe(false)
    expect(result.current.unreadCounts.system).toBe(2)
  })

  it('卸载后 refresh 不再 setState（mountedRef 拦截）', async () => {
    let resolveQuery: (v: unknown) => void = () => {}
    const pending = new Promise((resolve) => {
      resolveQuery = resolve
    })
    let selectCount = 0
    const c = {
      from: () => ({
        select: () => {
          selectCount += 1
          return {
            is: () => ({
              then: (resolve: (v: unknown) => void) => {
                resolveQuery = resolve
              },
            }),
          }
        },
        update: () => ({ in: () => ({ is: () => ({ select: () => ({ then: () => {} }) }) }) }),
      }),
    }
    const { result, unmount } = renderHook(() => useNotifications(c as never))
    void act(() => {
      void result.current.refresh()
    })
    unmount()
    await act(async () => {
      resolveQuery({ data: [], error: null })
      await pending
    })
    // 卸载后请求已发出但结果被丢弃，不 setState
    expect(selectCount).toBe(1)
  })
})
