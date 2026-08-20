// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRehearsals } from '../useRehearsals'

// 模块加载即校验环境变量，直接 mock 掉 supabase 模块（测试显式传 client，默认值不被使用）
vi.mock('@/lib/supabase', () => ({
  supabase: {},
}))

function mockClient<T>(responses: T[]) {
  let i = 0
  const chain = (res: T) => ({
    eq: () => chain(res),
    in: () => chain(res),
    order: () => chain(res),
    limit: () => chain(res),
    delete: () => chain(res),
    select: () => chain(res),
    single: () => res,
    then: (resolve: (v: T) => void) => resolve(res),
  })
  return {
    from: () => ({
      select: () => chain(responses[i++]),
      insert: () => chain(responses[i++]),
      update: () => ({ eq: () => chain(responses[i++]) }),
      delete: () => ({ eq: () => chain(responses[i++]) }),
    }),
  }
}

describe('useRehearsals', () => {
  afterEach(() => {
    cleanup()
  })

  it('fetch 排练列表', async () => {
    const c = mockClient([{ data: [{ id: 1, repertoire: '柴四' }], error: null }])
    const { result } = renderHook(() => useRehearsals(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toHaveLength(1)
  })

  it('fetch 空数据', async () => {
    const c = mockClient([{ data: [], error: null }])
    const { result } = renderHook(() => useRehearsals(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('fetch 失败：错误归一化为中文文案，清空列表', async () => {
    const c = mockClient([{ data: null, error: { message: 'connection refused' } }])
    const { result } = renderHook(() => useRehearsals(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    // 与 Web 差异：不透传 dbError.message，统一中文文案（不抛）
    expect(result.current.error).toBe('数据加载失败，请重试')
    expect(result.current.data).toEqual([])
  })

  it('create + 手动重取（refresh 语义）', async () => {
    const c = mockClient([
      { data: [], error: null }, // initial fetch
      { data: { id: 1 }, error: null }, // insert (returns id via .select("id").single())
      { data: [{ id: 1, repertoire: '新排练' }], error: null }, // re-fetch
    ])
    const { result } = renderHook(() => useRehearsals(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const id = await act(async () => {
      return await result.current.create({ repertoire: '新排练' })
    })
    expect(id).toBe(1)
    await waitFor(() => expect(result.current.data).toHaveLength(1))
  })

  it('update 不写 updated_at（由 DB 触发器统一写入，避免客户端时钟漂移）', async () => {
    const calls: Record<string, unknown>[] = []
    const chain = (res: unknown) => ({
      eq: () => chain(res),
      order: () => chain(res),
      select: () => chain(res),
      single: () => res,
      then: (resolve: (v: unknown) => void) => resolve(res),
    })
    const capturingClient = {
      from: () => ({
        select: () => chain({ data: [], error: null }),
        insert: () => chain({ data: null, error: null }),
        update: (payload: Record<string, unknown>) => {
          calls.push(payload)
          return { eq: () => chain({ data: [{ id: 1 }], error: null }) }
        },
        delete: () => ({ eq: () => chain({ data: null, error: null }) }),
      }),
    }
    const { result } = renderHook(() => useRehearsals(capturingClient as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(async () => {
      return await result.current.update(1, { repertoire: '新曲目' })
    })
    expect(ok).toBe(true)
    expect(result.current.error).toBeNull()
    expect(calls).toHaveLength(1)
    const payload = calls[0]
    expect(payload.repertoire).toBe('新曲目')
    // updated_at 不再由客户端写入（DB 触发器统一设置，与 created_at 同源时钟）
    expect(payload.updated_at).toBeUndefined()
  })

  it('remove 删除并重取', async () => {
    const c = mockClient([
      { data: [{ id: 1 }], error: null }, // fetch
      { data: null, error: null }, // rehearsals.delete
      { data: [], error: null }, // re-fetch
    ])
    const { result } = renderHook(() => useRehearsals(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(async () => {
      return await result.current.remove(1)
    })
    expect(ok).toBe(true)
    await waitFor(() => expect(result.current.data).toEqual([]))
  })

  it('卸载后手动 fetch 不再发起请求（mountedRef 拦截 setState）', async () => {
    let selectCount = 0
    const chain = (res: unknown) => ({
      eq: () => chain(res),
      order: () => chain(res),
      select: () => chain(res),
      single: () => res,
      then: (resolve: (v: unknown) => void) => resolve(res),
    })
    const c = {
      from: () => ({
        select: () => {
          selectCount += 1
          return chain({ data: [{ id: 1 }], error: null })
        },
        insert: () => chain({ data: null, error: null }),
        update: () => ({ eq: () => chain({ data: null, error: null }) }),
        delete: () => ({ eq: () => chain({ data: null, error: null }) }),
      }),
    }
    const { result, unmount } = renderHook(() => useRehearsals(c as never))
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
      select: () => chain(),
      single: () => chain(),
      then: (resolve: (v: unknown) => void) => {
        resolveFetch = resolve
      },
    })
    const c = {
      from: () => ({ select: () => chain() }),
    }
    const { unmount } = renderHook(() => useRehearsals(c as never))
    // 等微任务：await 在 thenable 上注册 resolver（then 由 Promise 机制异步调用）
    await act(async () => {})
    unmount()
    // 请求返回时组件已卸载：mountedRef 已置 false，setState 被跳过，不抛错
    await act(async () => {
      resolveFetch({ data: [{ id: 1 }], error: null })
    })
    expect(true).toBe(true)
  })
})
