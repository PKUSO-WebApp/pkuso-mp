// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAttendance } from '../useAttendance'

// 模块加载即校验环境变量，直接 mock 掉 supabase 模块（测试显式传 client，默认值不被使用）
vi.mock('@/lib/supabase', () => ({
  supabase: {},
}))

function mockClient<T>(responses: T[]) {
  let i = 0
  const c = (r: T) => ({
    eq: () => c(r),
    in: () => c(r),
    gte: () => c(r),
    lt: () => c(r),
    select: () => c(r),
    order: () => c(r),
    then: (resolve: (v: T) => void) => resolve(r),
  })
  return {
    from: () => ({
      select: () => c(responses[i++]),
      upsert: () => c(responses[i++]),
      insert: () => c(responses[i++]),
      // update().eq().select("id") 的 0 行检测链
      update: () => ({ eq: () => c(responses[i++]) }),
    }),
    rpc: () => c(responses[i++]),
  }
}

describe('useAttendance', () => {
  afterEach(() => {
    cleanup()
  })

  it('初始 loading 为 true（map 未就绪，调用方据此抑制首屏状态渲染）', () => {
    const { result } = renderHook(() => useAttendance(mockClient([]) as never))
    expect(result.current.loading).toBe(true)
  })

  it('fetchMyAttendances 查询 DB 并构建 map（RLS 允许 SELECT 自己的行）', async () => {
    const c = mockClient([
      {
        data: [
          { rehearsal_id: 1, status: 'present', sign_in_time: '2026-01-01T10:00:00' },
          { rehearsal_id: 2, status: 'late', sign_in_time: '2026-01-02T10:20:00' },
        ],
        error: null,
      },
    ])
    const { result } = renderHook(() => useAttendance(c as never))
    await act(async () => {
      await result.current.fetchMyAttendances('user-1', [1, 2])
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.map[1]).toEqual({
      status: 'present',
      sign_in_time: '2026-01-01T10:00:00',
    })
    expect(result.current.map[2]).toEqual({ status: 'late', sign_in_time: '2026-01-02T10:20:00' })
  })

  it('fetchMyAttendances 空 rehearsalIds 直接清空 map 并结束 loading', async () => {
    const c = mockClient([])
    const { result } = renderHook(() => useAttendance(c as never))
    await act(async () => {
      await result.current.fetchMyAttendances('user-1', [])
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.map).toEqual({})
  })

  it('fetchMyAttendances 查询失败时设置错误', async () => {
    const c = mockClient([{ data: null, error: { message: '权限不足' } }])
    const { result } = renderHook(() => useAttendance(c as never))
    await act(async () => {
      await result.current.fetchMyAttendances('user-1', [1])
    })
    expect(result.current.error).toContain('考勤数据加载失败')
  })

  it('fetchByRehearsal 查询 DB 返回列表（RLS 允许 SELECT 自己的行）', async () => {
    const rows = [
      { rehearsal_id: 1, user_id: 'u1', status: 'present', sign_in_time: '2026-01-01T10:00:00' },
    ]
    const c = mockClient([{ data: rows, error: null }])
    const { result } = renderHook(() => useAttendance(c as never))
    const resultRows = await act(() => result.current.fetchByRehearsal(1))
    expect(resultRows).toEqual(rows)
  })

  it('signIn 走安全定位 RPC，不接收客户端 user_id/status/sign_in_time', async () => {
    const c = mockClient([
      {
        data: [
          {
            id: 1,
            rehearsal_id: 1,
            user_id: 'u1',
            status: 'present',
            sign_in_time: '2026-01-01T10:00:00',
          },
        ],
        error: null,
      },
    ])
    const { result } = renderHook(() => useAttendance(c as never))
    const res = await act(() =>
      result.current.signIn({ rehearsal_id: 1, latitude: 39.99, longitude: 116.31, accuracy: 25 })
    )
    expect(res.error).toBeNull()
    expect(res.row).toEqual({
      id: 1,
      rehearsal_id: 1,
      user_id: 'u1',
      status: 'present',
      sign_in_time: '2026-01-01T10:00:00',
    })
  })

  it('signIn RPC 出错时返回错误信息', async () => {
    const c = mockClient([{ data: null, error: { message: 'outside check-in geofence' } }])
    const { result } = renderHook(() => useAttendance(c as never))
    const res = await act(() =>
      result.current.signIn({ rehearsal_id: 1, latitude: 30.0, longitude: 110.0 })
    )
    expect(res.error).toBe('outside check-in geofence')
    expect(res.row).toBeNull()
  })

  it('fetchMyHistory 查询本人考勤历史并返回 join 行', async () => {
    const rows = [
      {
        id: 1,
        rehearsal_id: 1,
        user_id: 'u1',
        status: 'present',
        sign_in_time: '2026-01-01T10:00:00',
        rehearsals: { start_time: '2026-01-01T09:00:00', location: '排练厅' },
      },
    ]
    const c = mockClient([{ data: rows, error: null }])
    const { result } = renderHook(() => useAttendance(c as never))
    const res = await act(() => result.current.fetchMyHistory('u1', {}))
    expect(res.error).toBeNull()
    expect(res.rows).toEqual(rows)
  })

  it('fetchMyHistory 带日期过滤查询（gte/lt 链式构建不报错）', async () => {
    const c = mockClient([{ data: [], error: null }])
    const { result } = renderHook(() => useAttendance(c as never))
    const res = await act(() =>
      result.current.fetchMyHistory('u1', { startDate: '2026-01-01', endDate: '2026-01-31' })
    )
    expect(res.error).toBeNull()
    expect(res.rows).toEqual([])
  })

  it('fetchMyHistory 查询失败返回空 rows 与错误信息', async () => {
    const c = mockClient([{ data: null, error: { message: '查询失败' } }])
    const { result } = renderHook(() => useAttendance(c as never))
    const res = await act(() => result.current.fetchMyHistory('u1', {}))
    expect(res.error).toBe('查询失败')
    expect(res.rows).toEqual([])
  })

  it('卸载后调用 fetchMyAttendances 不再发起请求（mountedRef 拦截 setState）', async () => {
    let selectCount = 0
    const chain = (res: unknown) => ({
      eq: () => chain(res),
      in: () => chain(res),
      select: () => chain(res),
      order: () => chain(res),
      then: (resolve: (v: unknown) => void) => resolve(res),
    })
    const c = {
      from: () => ({
        select: () => {
          selectCount += 1
          return chain({ data: [], error: null })
        },
        upsert: () => chain({ error: null }),
        insert: () => chain({ error: null }),
        update: () => ({ eq: () => chain({ data: [], error: null }) }),
      }),
    }
    const { result, unmount } = renderHook(() => useAttendance(c as never))
    unmount()

    await act(async () => {
      await result.current.fetchMyAttendances('user-1', [1, 2])
    })
    // 卸载后请求被提前拦截，不再发查询、不再 setState
    expect(selectCount).toBe(0)
    await act(async () => {
      await result.current.fetchByRehearsal(1)
    })
    expect(selectCount).toBe(0)
  })
})
