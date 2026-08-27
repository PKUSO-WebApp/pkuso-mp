import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribeSync, emitSync, dataSyncStart, dataSyncStop } from './dataSync'

const { tableData, supabaseMock } = vi.hoisted(() => {
  const data: Record<string, { row?: any; count?: number; error?: any }> = {
    rehearsals: { row: { updated_at: '2026-01-01T00:00:00' } },
    announcements: { row: { created_at: '2026-01-01T00:00:00' } },
    leave: { row: { updated_at: '2026-01-01T00:00:00' } },
    posts: { row: { created_at: '2026-01-01T00:00:00' } },
    notifications: { count: 0 },
  }
  const makeBuilder = (table: string) => {
    const b: any = {}
    b.select = () => b
    b.order = () => b
    b.limit = () => b
    b.eq = () => b
    b.is = () => Promise.resolve({ count: data[table]?.count ?? 0, error: null })
    b.maybeSingle = () =>
      Promise.resolve({ data: data[table]?.row ?? null, error: data[table]?.error ?? null })
    return b
  }
  return { tableData: data, supabaseMock: { from: (table: string) => makeBuilder(table) } }
})

vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }))
vi.mock('@/lib/session-diag', () => ({ logDiag: vi.fn() }))

describe('dataSync 心跳（P3-3）', () => {
  afterEach(() => {
    dataSyncStop()
    vi.useRealTimers()
  })

  it('事件总线：emitSync 触发订阅者，退订后停止', () => {
    const cb = vi.fn()
    const unsub = subscribeSync('post', cb)
    emitSync('post')
    expect(cb).toHaveBeenCalledTimes(1)
    unsub()
    emitSync('post')
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('心跳：基线轮询不广播，版本变化后广播对应实体', async () => {
    vi.useFakeTimers()
    const cb = vi.fn()
    subscribeSync('rehearsals', cb)
    dataSyncStart()
    // 首轮 tick 建基线，不广播
    await vi.advanceTimersByTimeAsync(30000)
    expect(cb).not.toHaveBeenCalled()
    // 改版本
    tableData.rehearsals.row = { updated_at: '2026-02-02T00:00:00' }
    await vi.advanceTimersByTimeAsync(30000)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('心跳：未读数变化广播 notifications（覆盖后台新增漏报窗口）', async () => {
    vi.useFakeTimers()
    tableData.notifications.count = 0
    const cb = vi.fn()
    subscribeSync('notifications', cb)
    dataSyncStart()
    await vi.advanceTimersByTimeAsync(30000) // 基线，lastKnownUnread=0，不广播
    expect(cb).not.toHaveBeenCalled()
    tableData.notifications.count = 3
    await vi.advanceTimersByTimeAsync(30000)
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
