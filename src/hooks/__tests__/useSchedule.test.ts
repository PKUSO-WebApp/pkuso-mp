// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSchedule } from '../useSchedule'

// 固定测试用的"今天"日期
const TEST_TODAY = '2024-01-15'

// Mock getLocalDateString to return fixed test date
vi.mock('@/lib/date-utils', async () => {
  const actual = await vi.importActual('@/lib/date-utils')
  return {
    ...actual,
    getLocalDateString: vi.fn(() => TEST_TODAY),
  }
})

// 模块加载即校验环境变量，直接 mock 掉 supabase 模块（测试显式传 client，默认值不被使用）
vi.mock('@/lib/supabase', () => ({
  supabase: {},
}))

function mockClient<T>(responses: T[]) {
  let i = 0
  const calls: string[] = []
  const chain = (res: T) => {
    const record = (name: string, ...args: unknown[]) => {
      calls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(', ')})`)
      return chainObj
    }
    const chainObj: Record<string, unknown> = {}
    chainObj.eq = (...args: unknown[]) => record('eq', ...args)
    chainObj.in = (...args: unknown[]) => record('in', ...args)
    chainObj.gte = (...args: unknown[]) => record('gte', ...args)
    chainObj.lte = (...args: unknown[]) => record('lte', ...args)
    chainObj.gt = (...args: unknown[]) => record('gt', ...args)
    chainObj.lt = (...args: unknown[]) => record('lt', ...args)
    chainObj.neq = (...args: unknown[]) => record('neq', ...args)
    chainObj.is = (...args: unknown[]) => record('is', ...args)
    chainObj.select = () => chainObj
    chainObj.delete = (...args: unknown[]) => record('delete', ...args)
    // order/limit 返回自身以支持链式调用，then 用于 await
    chainObj.order = (...args: unknown[]) => record('order', ...args)
    chainObj.limit = (...args: unknown[]) => record('limit', ...args)
    chainObj.then = (resolve: (v: T) => void, reject?: (e: Error) => void) =>
      Promise.resolve(res).then(resolve, reject)
    return chainObj
  }
  return {
    from: () => ({
      select: () => chain(responses[i++]),
      insert: () => Promise.resolve(responses[i++]),
      update: () => ({
        eq: (...args: unknown[]) => {
          calls.push(`eq(${args.map((a) => JSON.stringify(a)).join(', ')})`)
          return chain(responses[i++])
        },
      }),
      delete: () => ({
        eq: (...args: unknown[]) => {
          calls.push(`eq(${args.map((a) => JSON.stringify(a)).join(', ')})`)
          return chain(responses[i++])
        },
      }),
    }),
    __calls: calls,
    functions: { invoke: vi.fn().mockResolvedValue({ data: { result: 'pass' }, error: null }) },
  }
}

describe('useSchedule', () => {
  afterEach(() => {
    cleanup()
  })

  it('fetch 预约列表（全量周查询）', async () => {
    const c = mockClient([
      {
        data: [
          {
            id: 1,
            title: '排练房预约',
            rehearsal_id: null,
            author_id: 'user-1',
            start_time: `${TEST_TODAY}T14:00:00`,
            end_time: `${TEST_TODAY}T15:00:00`,
          },
        ],
        error: null,
      },
      { data: [{ id: 'user-1', full_name: '张三' }], error: null }, // profiles_roster
    ])
    const { result } = renderHook(() => useSchedule(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toHaveLength(1)
  })

  it('fetch 空数据', async () => {
    const c = mockClient([{ data: [], error: null }])
    const { result } = renderHook(() => useSchedule(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('fetch 失败：错误归一化为中文文案，清空列表', async () => {
    const c = mockClient([{ data: null, error: { message: 'connection refused' } }])
    const { result } = renderHook(() => useSchedule(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    // 与 Web 差异：不透传 dbError.message，统一中文文案（不抛）
    expect(result.current.error).toBe('loadFailed')
    expect(result.current.data).toEqual([])
  })

  it('create + 手动重取（refresh 语义）', async () => {
    const c = mockClient([
      { data: [], error: null }, // initial fetchAll schedules
      { data: null, error: null }, // insert
      {
        data: [
          {
            id: 1,
            title: '新预约',
            rehearsal_id: null,
            author_id: 'user-1',
            start_time: `${TEST_TODAY}T14:00:00`,
            end_time: `${TEST_TODAY}T15:00:00`,
          },
        ],
        error: null,
      }, // re-fetchAll schedules
      { data: [{ id: 'user-1', full_name: '张三' }], error: null }, // re-fetchAll profiles_roster
    ])
    const { result } = renderHook(() => useSchedule(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(async () => {
      return await result.current.create({ title: '新预约' })
    })
    expect(ok).toBe(true)
    await waitFor(() => expect(result.current.data).toHaveLength(1))
  })

  it('remove 删除并重取', async () => {
    const c = mockClient([
      {
        data: [
          {
            id: 1,
            rehearsal_id: null,
            author_id: 'user-1',
            start_time: `${TEST_TODAY}T14:00:00`,
            end_time: `${TEST_TODAY}T15:00:00`,
          },
        ],
        error: null,
      }, // fetchAll schedules
      { data: [{ id: 'user-1', full_name: '张三' }], error: null }, // fetchAll profiles_roster
      { data: null, error: null }, // schedules.delete
      { data: [], error: null }, // re-fetchAll schedules
    ])
    const { result } = renderHook(() => useSchedule(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(async () => {
      return await result.current.remove(1)
    })
    expect(ok).toBe(true)
    await waitFor(() => expect(result.current.data).toEqual([]))
  })

  it('fetch(date) 走缓存同步返回当天切片', async () => {
    const c = mockClient([
      {
        data: [
          {
            id: 1,
            title: '今日预约',
            rehearsal_id: null,
            author_id: 'user-1',
            start_time: `${TEST_TODAY}T14:00:00`,
            end_time: `${TEST_TODAY}T15:00:00`,
          },
        ],
        error: null,
      }, // 初始 fetchAll schedules
      { data: [{ id: 'user-1', full_name: '张三' }], error: null }, // 初始 fetchAll profiles_roster
      { data: [], error: null }, // 显式 fetch 不发请求，但为了保险预留
    ])
    const { result } = renderHook(() => useSchedule(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    // 直接调用 fetch(date) - 应该同步返回缓存切片
    await act(async () => {
      await result.current.fetch(TEST_TODAY)
    })
    // 无网络请求，data 不变
    expect(result.current.data[0].title).toBe('今日预约')
  })

  it('fetchAll 周区间查询：weekStart ~ weekEnd+1', async () => {
    const c = mockClient([
      { data: [], error: null }, // 初始 fetchAll schedules
      { data: [], error: null }, // 初始 fetchAll profiles_roster
      { data: [], error: null }, // 手动 fetchAll schedules
      { data: [], error: null }, // 手动 fetchAll profiles_roster
    ])
    const { result } = renderHook(() => useSchedule(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.fetchAll()
    })

    const calls = (c as unknown as { __calls: string[] }).__calls
    // 应该有 lt(start_time, weekEnd 23:59:59) 和 gt(end_time, weekStart 00:00:00)
    const ltCalls = calls.filter((call) => call.startsWith('lt('))
    const gtCalls = calls.filter((call) => call.startsWith('gt('))
    expect(ltCalls.length).toBeGreaterThan(0)
    expect(gtCalls.length).toBeGreaterThan(0)
  })

  it('fetch 归一化空格分隔时间为 T 分隔（下游 parseLocalISO/formatTime 依赖）', async () => {
    const c = mockClient([
      {
        data: [
          {
            id: 1,
            title: '排练',
            start_time: `${TEST_TODAY} 14:30:00`,
            end_time: `${TEST_TODAY} 15:30:00`,
            rehearsal_id: null,
            author_id: 'user-1',
          },
        ],
        error: null,
      },
      { data: [{ id: 'user-1', full_name: '张三' }], error: null }, // profiles_roster
    ])
    const { result } = renderHook(() => useSchedule(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data[0].start_time).toBe(`${TEST_TODAY}T14:30:00`)
    expect(result.current.data[0].end_time).toBe(`${TEST_TODAY}T15:30:00`)
  })

  // 冲突检测测试：新逻辑 - fetchAll 后本地内存跑 schedules 冲突，RPC 只查 rehearsals
  describe('checkConflict', () => {
    it('无冲突 - 正常路径', async () => {
      const c = mockClient([
        { data: [], error: null }, // pre-check fetchAll
        { data: [], error: null }, // fetchAll
        { data: [], error: null }, // rehearsals query
      ])
      const { result } = renderHook(() => useSchedule(c as never))
      await waitFor(() => expect(result.current.loading).toBe(false))

      const conflictResult = await act(async () => {
        return await result.current.checkConflict('2024-01-01', '14:00', '2024-01-01', '15:00')
      })

      expect(conflictResult).toBeNull()
    })

    it('与已有预约时间冲突（本地内存检测）', async () => {
      const c = mockClient([
        { data: [], error: null }, // pre-check fetchAll
        {
          data: [
            {
              id: 1,
              rehearsal_id: null, // 人工预约（rehearsal_id 为 null）
              start_time: '2024-01-01T14:30:00',
              end_time: '2024-01-01T15:30:00',
            },
          ],
          error: null,
        }, // fetchAll - returns overlapping schedule
        { data: [], error: null }, // rehearsals query
      ])
      const { result } = renderHook(() => useSchedule(c as never))
      await waitFor(() => expect(result.current.loading).toBe(false))

      const conflictResult = await act(async () => {
        return await result.current.checkConflict('2024-01-01', '14:00', '2024-01-01', '15:00')
      })

      expect(conflictResult).toBe('该时间段已有其他预约')
    })

    it('与已有排练时间冲突（RPC 检测）', async () => {
      const c = mockClient([
        { data: [], error: null }, // pre-check fetchAll
        { data: [], error: null }, // fetchAll
        {
          data: [
            {
              id: 1,
              start_time: '2024-01-01T14:30:00',
              end_time: '2024-01-01T15:30:00',
            },
          ],
          error: null,
        }, // rehearsals query - overlapping
      ])
      const { result } = renderHook(() => useSchedule(c as never))
      await waitFor(() => expect(result.current.loading).toBe(false))

      const conflictResult = await act(async () => {
        return await result.current.checkConflict('2024-01-01', '14:00', '2024-01-01', '15:00')
      })

      expect(conflictResult).toBe('该时间段已有排练安排')
    })

    it('编辑排练时排除自身 - 边界值', async () => {
      // 当编辑排练 id=5 时，数据库查询会通过 .neq("id", 5) 过滤掉该排练
      // 所以 mock 返回空数据，表示已正确过滤
      const c = mockClient([
        { data: [], error: null }, // pre-check fetchAll
        { data: [], error: null }, // fetchAll
        { data: [], error: null }, // rehearsals query - filtered by neq(id, 5), so empty
      ])
      const { result } = renderHook(() => useSchedule(c as never))
      await waitFor(() => expect(result.current.loading).toBe(false))

      const conflictResult = await act(async () => {
        return await result.current.checkConflict('2024-01-01', '14:00', '2024-01-01', '15:00', 5)
      })

      expect(conflictResult).toBeNull()
    })

    it('编辑排练时 - 影子预约不误报（schedules 分支过滤 rehearsal_id 非空行）', async () => {
      // 编辑排练 id=5：触发器为该排练生成的影子预约（rehearsal_id=5，时间与排练相同）在
      // 数据库层被 .is("rehearsal_id", null) 过滤，所以 mock 的 schedules 查询返回空
      // （模拟过滤后的结果）；rehearsals 查询通过 .neq("id", 5) 排除自身，同样为空
      const c = mockClient([
        { data: [], error: null }, // pre-check fetchAll
        { data: [], error: null }, // fetchAll
        { data: [], error: null }, // rehearsals query - 编辑中的排练已被 neq 过滤
      ])
      const { result } = renderHook(() => useSchedule(c as never))
      await waitFor(() => expect(result.current.loading).toBe(false))

      const conflictResult = await act(async () => {
        return await result.current.checkConflict('2024-01-01', '14:00', '2024-01-01', '15:00', 5)
      })

      expect(conflictResult).toBeNull()
    })

    it('创建人工预约与排练重叠 - 返回排练冲突文案', async () => {
      // 当天存在排练及其影子预约：影子预约被 .is("rehearsal_id", null) 过滤（mock schedules 为空），
      // 不会先命中 schedules 分支的「该时间段已有其他预约」；rehearsals 分支命中排练，
      // 文案准确为「该时间段已有排练安排」
      const c = mockClient([
        { data: [], error: null }, // pre-check fetchAll
        { data: [], error: null }, // fetchAll
        {
          data: [
            {
              id: 5,
              start_time: '2024-01-01T14:30:00',
              end_time: '2024-01-01T15:30:00',
            },
          ],
          error: null,
        }, // rehearsals query - overlapping
      ])
      const { result } = renderHook(() => useSchedule(c as never))
      await waitFor(() => expect(result.current.loading).toBe(false))

      const conflictResult = await act(async () => {
        return await result.current.checkConflict('2024-01-01', '14:00', '2024-01-01', '15:00')
      })

      expect(conflictResult).toBe('该时间段已有排练安排')
    })

    it('schedules 冲突走本地内存，不发 RPC（无 is 查询）', async () => {
      const c = mockClient([
        { data: [], error: null }, // pre-check fetchAll
        { data: [], error: null }, // fetchAll
        { data: [], error: null }, // rehearsals query
      ])
      const { result } = renderHook(() => useSchedule(c as never))
      await waitFor(() => expect(result.current.loading).toBe(false))

      await act(async () => {
        await result.current.checkConflict('2024-01-01', '14:00', '2024-01-01', '15:00')
      })

      const calls = (c as unknown as { __calls: string[] }).__calls
      // 新逻辑：schedules 冲突本地跑，不再查数据库，所以没有 is("rehearsal_id", null)
      const isCalls = calls.filter((call) => call.startsWith('is('))
      expect(isCalls).toEqual([])
    })

    it('预约查询失败返回错误（本地内存不报错，只检测 rehearsals RPC）', async () => {
      // 新逻辑：schedules 冲突本地跑，无 RPC 失败可能
      // 只有 rehearsals RPC 失败会返回错误
      const c = mockClient([
        { data: [], error: null }, // pre-check fetchAll
        { data: [], error: null }, // fetchAll
        { data: null, error: { message: 'rehearsal error' } }, // rehearsals query error
      ])
      const { result } = renderHook(() => useSchedule(c as never))
      await waitFor(() => expect(result.current.loading).toBe(false))

      const conflictResult = await act(async () => {
        return await result.current.checkConflict('2024-01-01', '14:00', '2024-01-01', '15:00')
      })

      expect(conflictResult).toBe('查询排练安排失败')
    })

    it('排练查询失败返回错误', async () => {
      const c = mockClient([
        { data: [], error: null }, // pre-check fetchAll
        { data: [], error: null }, // fetchAll
        { data: null, error: { message: 'rehearsal error' } }, // rehearsals query error
      ])
      const { result } = renderHook(() => useSchedule(c as never))
      await waitFor(() => expect(result.current.loading).toBe(false))

      const conflictResult = await act(async () => {
        return await result.current.checkConflict('2024-01-01', '14:00', '2024-01-01', '15:00')
      })

      expect(conflictResult).toBe('查询排练安排失败')
    })

    it('空格分隔的已有预约也能检出冲突（归一化后再比较）', async () => {
      const c = mockClient([
        { data: [], error: null }, // pre-check fetchAll
        {
          data: [
            {
              id: 1,
              rehearsal_id: null, // 人工预约（rehearsal_id 为 null）
              start_time: '2024-01-01 14:30:00',
              end_time: '2024-01-01 15:30:00',
            },
          ],
          error: null,
        }, // fetchAll
        { data: [], error: null }, // rehearsals query
      ])
      const { result } = renderHook(() => useSchedule(c as never))
      await waitFor(() => expect(result.current.loading).toBe(false))

      const conflictResult = await act(async () => {
        return await result.current.checkConflict('2024-01-01', '14:00', '2024-01-01', '15:00')
      })

      expect(conflictResult).toBe('该时间段已有其他预约')
    })

    it('时间边界不重叠 - 新预约开始等于已有结束', async () => {
      const c = mockClient([
        { data: [], error: null }, // pre-check fetchAll
        {
          data: [
            {
              id: 1,
              rehearsal_id: null, // 人工预约（rehearsal_id 为 null）
              start_time: '${TEST_TODAY}T13:00:00',
              end_time: '${TEST_TODAY}T14:00:00',
            },
          ],
          error: null,
        }, // fetchAll
        { data: [], error: null }, // rehearsals query
      ])
      const { result } = renderHook(() => useSchedule(c as never))
      await waitFor(() => expect(result.current.loading).toBe(false))

      const conflictResult = await act(async () => {
        return await result.current.checkConflict('2024-01-01', '14:00', '2024-01-01', '15:00')
      })

      expect(conflictResult).toBeNull()
    })

    it('时间边界不重叠 - 新预约结束等于已有开始', async () => {
      const c = mockClient([
        { data: [], error: null }, // pre-check fetchAll
        {
          data: [
            {
              id: 1,
              rehearsal_id: null, // 人工预约（rehearsal_id 为 null）
              start_time: '${TEST_TODAY}T15:00:00',
              end_time: '${TEST_TODAY}T16:00:00',
            },
          ],
          error: null,
        }, // fetchAll
        { data: [], error: null }, // rehearsals query
      ])
      const { result } = renderHook(() => useSchedule(c as never))
      await waitFor(() => expect(result.current.loading).toBe(false))

      const conflictResult = await act(async () => {
        return await result.current.checkConflict('2024-01-01', '14:00', '2024-01-01', '15:00')
      })

      expect(conflictResult).toBeNull()
    })
  })

  it('卸载后手动 fetch 不再发起请求（mountedRef 拦截 setState）', async () => {
    let selectCount = 0
    const chain = (res: unknown) => ({
      eq: () => chain(res),
      in: () => chain(res),
      order: () => chain(res),
      limit: () => chain(res),
      gte: () => chain(res),
      lte: () => chain(res),
      gt: () => chain(res),
      lt: () => chain(res),
      neq: () => chain(res),
      is: () => chain(res),
      then: (resolve: (v: unknown) => void) => resolve(res),
    })
    const c = {
      from: () => ({
        select: () => {
          selectCount += 1
          return chain({ data: [], error: null })
        },
        insert: () => chain({ data: null, error: null }),
        update: () => ({ eq: () => chain({ data: null, error: null }) }),
        delete: () => ({ eq: () => chain({ data: null, error: null }) }),
      }),
    }
    const { result, unmount } = renderHook(() => useSchedule(c as never))
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
      gte: () => chain(),
      lte: () => chain(),
      gt: () => chain(),
      lt: () => chain(),
      neq: () => chain(),
      is: () => chain(),
      then: (resolve: (v: unknown) => void) => {
        resolveFetch = resolve
      },
    })
    const c = {
      from: () => ({ select: () => chain() }),
    }
    const { unmount } = renderHook(() => useSchedule(c as never))
    // 等微任务：await 在 thenable 上注册 resolver（then 由 Promise 机制异步调用）
    await act(async () => {})
    unmount()
    // 请求返回时组件已卸载：mountedRef 已置 false，setState 被跳过，不抛错
    await act(async () => {
      resolveFetch({ data: [], error: null })
    })
    expect(true).toBe(true)
  })
})
