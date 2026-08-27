// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useProfiles } from '../useProfiles'

// 模块加载即校验环境变量，直接 mock 掉 supabase 模块（测试显式传 client，默认值不被使用）
vi.mock('@/lib/supabase', () => ({
  supabase: {},
}))

function mockClient<T>(responses: T[], fromTables?: string[]) {
  let i = 0
  const chain = (res: T) => ({
    eq: () => chain(res),
    in: () => chain(res),
    maybeSingle: () => chain(res),
    order: () => chain(res),
    limit: () => chain(res),
    then: (resolve: (v: T) => void) => resolve(res),
  })
  return {
    from: (table: string) => {
      // 记录 from 的表名，供「查询走视图」断言使用
      fromTables?.push(table)
      return {
        select: () => chain(responses[i++]),
        update: () => ({ eq: () => ({ select: () => chain(responses[i++]) }) }),
        insert: () => chain(responses[i++]),
      }
    },
  }
}

describe('useProfiles', () => {
  afterEach(() => {
    cleanup()
  })

  it('status 过滤 profiles', async () => {
    const c = mockClient([
      { data: [{ id: '1', full_name: '张三', status: 'approved' }], error: null },
    ])
    const { result } = renderHook(() => useProfiles({ status: 'approved' }, c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toHaveLength(1)
  })

  it('读取走 profiles_roster 视图（不直查 profiles 表敏感列）', async () => {
    const fromTables: string[] = []
    const c = mockClient(
      [
        {
          data: [{ id: '1', full_name: '张三', hide_email: false, email: 'a@b.com' }],
          error: null,
        },
      ],
      fromTables
    )
    const { result } = renderHook(() => useProfiles({ status: 'approved' }, c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    // fetch 只发一次查询且走视图；视图行断言回 ProfileRow 后字段可正常消费
    expect(fromTables).toEqual(['profiles_roster'])
    expect(result.current.data[0].email).toBe('a@b.com')
  })

  it('fetch 失败：错误归一化为中文文案，清空列表', async () => {
    const c = mockClient([{ data: null, error: { message: 'connection refused' } }])
    const { result } = renderHook(() => useProfiles({ status: 'pending' }, c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    // 与 Web 差异：不透传 dbError.message，统一中文文案（不抛）
    expect(result.current.error).toBe('loadFailed')
    expect(result.current.data).toEqual([])
  })

  it('userId 明确传 undefined 时不发请求并返回空列表', async () => {
    // client 被调用即抛错：若发请求测试会失败
    const c = {
      from: () => {
        throw new Error('不应发起请求')
      },
    }
    const { result } = renderHook(() => useProfiles({ userId: undefined }, c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('insert 创建 profile', async () => {
    const c = mockClient([{ data: [], error: null }, { error: null }])
    const { result } = renderHook(() => useProfiles(undefined, c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(() =>
      result.current.insert({
        id: 'u1',
        email: 'a@b.com',
        full_name: '王五',
        instrument: '大提琴',
      })
    )
    expect(ok).toBe(true)
  })

  it('insert 失败返回 false 并写入 error', async () => {
    const c = mockClient([{ data: [], error: null }, { error: { message: '插入失败' } }])
    const { result } = renderHook(() => useProfiles(undefined, c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(() =>
      result.current.insert({
        id: 'u1',
        email: 'a@b.com',
        full_name: '王五',
        instrument: '大提琴',
      })
    )
    expect(ok).toBe(false)
    expect(result.current.error).toBe('saveFailed')
  })

  it('update 成功时返回 true 并更新本地数据', async () => {
    const c = mockClient([
      { data: [{ id: '1', full_name: '张三', status: 'approved' }], error: null },
      { data: [{ id: '1' }], error: null },
    ])
    const { result } = renderHook(() => useProfiles({ status: 'approved' }, c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let ok = false
    await act(async () => {
      ok = await result.current.update('1', { phone_number: '13800138000' })
    })
    expect(ok).toBe(true)
    expect(result.current.data[0].phone_number).toBe('13800138000')
    expect(result.current.error).toBeNull()
  })

  it('update 被 RLS 拒绝（返回空数组，静默失败）时返回 false 并设置错误', async () => {
    const c = mockClient([
      { data: [{ id: '1', full_name: '张三', status: 'approved' }], error: null },
      { data: [], error: null }, // RLS 拒绝：PostgREST 返回 200 + 空数据
    ])
    const { result } = renderHook(() => useProfiles({ status: 'approved' }, c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let ok = true
    await act(async () => {
      ok = await result.current.update('1', { phone_number: '13800138000' })
    })
    expect(ok).toBe(false)
    expect(result.current.error).toBe('saveFailed')
    // 本地数据不应被污染（保留旧值）
    expect(result.current.data[0]).not.toHaveProperty('phone_number', '13800138000')
  })

  it('update 数据库错误时返回 false 并设置错误信息', async () => {
    const c = mockClient([
      { data: [], error: null },
      { data: null, error: { message: 'db error' } },
    ])
    const { result } = renderHook(() => useProfiles(undefined, c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let ok = true
    await act(async () => {
      ok = await result.current.update('1', { full_name: '李四' })
    })
    expect(ok).toBe(false)
    expect(result.current.error).toBe('saveFailed')
  })

  it('fetch 竞态保护：旧请求返回不覆盖新数据', async () => {
    // 模拟两次 fetch，第一次慢第二次快，验证最终数据是第二次的
    const oldData = [{ id: '1', full_name: '旧数据', status: 'pending' }]
    const newData = [{ id: '2', full_name: '新数据', status: 'pending' }]

    let firstResolve!: (value: unknown) => void
    let callCount = 0

    const chain = (res: unknown, isSlow = false) => ({
      eq: () => chain(res, isSlow),
      in: () => chain(res, isSlow),
      order: () => chain(res, isSlow),
      then: (resolve: (v: unknown) => void) => {
        if (isSlow) {
          // 慢请求：等待手动触发
          firstResolve = resolve
        } else {
          resolve(res)
        }
      },
    })

    const c = {
      from: () => ({
        select: () => {
          callCount += 1
          if (callCount === 1) {
            return chain({ data: oldData, error: null }, true)
          }
          return chain({ data: newData, error: null }, false)
        },
      }),
    }

    const { result } = renderHook(() => useProfiles({ status: 'pending' }, c as never))
    // useEffect 会触发第一次 fetch（慢）
    // 手动触发第二次 fetch（快，立即返回）
    await act(async () => {
      await result.current.fetch()
    })

    // 此时 data 应该是第二次的结果
    expect(result.current.data[0].id).toBe('2')

    // 让第一次请求返回
    await act(async () => {
      firstResolve({ data: oldData, error: null })
      await new Promise((r) => setTimeout(r, 10))
    })

    // data 不应被旧请求覆盖
    expect(result.current.data[0].id).toBe('2')
  })

  it('卸载后手动 fetch 不再发起请求（mountedRef 拦截 setState）', async () => {
    let selectCount = 0
    const chain = (res: unknown) => ({
      eq: () => chain(res),
      in: () => chain(res),
      order: () => chain(res),
      then: (resolve: (v: unknown) => void) => resolve(res),
    })
    const c = {
      from: () => ({
        select: () => {
          selectCount += 1
          return chain({ data: [], error: null })
        },
        update: () => ({ eq: () => ({ select: () => chain({ data: [], error: null }) }) }),
        insert: () => chain({ error: null }),
      }),
    }
    const { result, unmount } = renderHook(() => useProfiles({ status: 'pending' }, c as never))
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
      in: () => chain(),
      order: () => chain(),
      then: (resolve: (v: unknown) => void) => {
        resolveFetch = resolve
      },
    })
    const c = {
      from: () => ({ select: () => chain() }),
    }
    const { unmount } = renderHook(() => useProfiles({ status: 'pending' }, c as never))
    // 等微任务：await 在 thenable 上注册 resolver（then 由 Promise 机制异步调用）
    await act(async () => {})
    unmount()
    // 请求返回时组件已卸载：mountedRef 已置 false，setState 被跳过，不抛错
    await act(async () => {
      resolveFetch({ data: [{ id: '1' }], error: null })
    })
    expect(true).toBe(true)
  })
})
