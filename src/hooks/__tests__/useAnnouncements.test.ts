// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAnnouncements } from '../useAnnouncements'

// 模块加载即校验环境变量，直接 mock 掉 supabase 模块（测试显式传 client，默认值不被使用）
vi.mock('@/lib/supabase', () => ({
  supabase: {},
}))

function mockClient<T>(responses: T[]) {
  let i = 0
  const c = (r: T) => ({
    eq: () => c(r),
    order: () => c(r),
    limit: () => c(r),
    then: (resolve: (v: T) => void) => resolve(r),
  })
  return {
    from: () => ({ select: () => c(responses[i++]) }),
  }
}

describe('useAnnouncements', () => {
  afterEach(() => {
    cleanup()
  })

  it('fetch 获取所有公告', async () => {
    const c = mockClient([{ data: [{ id: '1', content: '测试' }], error: null }])
    const { result } = renderHook(() => useAnnouncements(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual([{ id: '1', content: '测试' }])
  })

  it('fetch 失败：错误归一化为中文文案，data 置空数组', async () => {
    const c = mockClient([{ data: null, error: { message: 'connection refused' } }])
    const { result } = renderHook(() => useAnnouncements(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    // 与 Web 差异：不透传 dbError.message，统一中文文案（不抛）
    expect(result.current.error).toBe('loadFailed')
    expect(result.current.data).toEqual([])
  })

  it('无公告：data 为空数组且无错误', async () => {
    const c = mockClient([{ data: [], error: null }])
    const { result } = renderHook(() => useAnnouncements(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('手动重取（refresh 语义）：再次查询并更新 data', async () => {
    const c = mockClient([
      { data: [{ id: '1', content: '旧公告' }], error: null },
      { data: [{ id: '2', content: '新公告' }], error: null },
    ])
    const { result } = renderHook(() => useAnnouncements(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual([{ id: '1', content: '旧公告' }])

    await act(async () => {
      await result.current.fetch()
    })
    expect(result.current.data).toEqual([{ id: '2', content: '新公告' }])
  })

  it('卸载后手动 fetch 不再发起请求（mountedRef 拦截 setState）', async () => {
    let selectCount = 0
    const chain = (res: unknown) => ({
      eq: () => chain(res),
      order: () => chain(res),
      limit: () => chain(res),
      then: (resolve: (v: unknown) => void) => resolve(res),
    })
    const c = {
      from: () => ({
        select: () => {
          selectCount += 1
          return chain({ data: [{ id: '1', content: '测试' }], error: null })
        },
      }),
    }
    const { result, unmount } = renderHook(() => useAnnouncements(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    unmount()

    await act(async () => {
      await result.current.fetch()
    })
    // 卸载后 fetch 被 mountedRef 提前拦截，不再发查询、不再 setState
    expect(selectCount).toBe(1)
  })

  it('挂载请求返回时组件已卸载：跳过 setState 不抛错', async () => {
    let resolveFetch!: (v: unknown) => void
    const chain = () => ({
      eq: () => chain(),
      order: () => chain(),
      limit: () => chain(),
      then: (resolve: (v: unknown) => void) => {
        resolveFetch = resolve
      },
    })
    const c = {
      from: () => ({ select: () => chain() }),
    }
    const { unmount } = renderHook(() => useAnnouncements(c as never))
    // 等微任务：await 在 thenable 上注册 resolver（then 由 Promise 机制异步调用）
    await act(async () => {})
    unmount()
    // 请求返回时组件已卸载：mountedRef 已置 false，setState 被跳过，不抛错
    await act(async () => {
      resolveFetch({ data: [{ id: '1', content: '测试' }], error: null })
    })
    expect(true).toBe(true)
  })
})