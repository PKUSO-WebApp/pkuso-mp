import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribeSync, emitSync, dataSyncStart, dataSyncStop } from './dataSync'

const { rpcData, supabaseMock } = vi.hoisted(() => {
  const data: {
    rehearsals: string | null
    announcements: string | null
    leave: string | null
    post: string | null
    notifications_unread: number | null
  } = {
    rehearsals: '2026-01-01T00:00:00',
    announcements: '2026-01-01T00:00:00',
    leave: '2026-01-01T00:00:00',
    post: '2026-01-01T00:00:00',
    notifications_unread: 0,
  }
  const mock = {
    rpc: vi.fn(() => Promise.resolve({ data, error: null })),
  }
  return { rpcData: data, supabaseMock: mock }
})

vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }))
vi.mock('@/lib/session-diag', () => ({ logDiag: vi.fn() }))

describe('dataSync 心跳（P3-3）', () => {
  afterEach(() => {
    dataSyncStop()
    vi.useRealTimers()
    vi.clearAllMocks()
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
    // 首轮 tick 建基线，不广播（推进 45s 覆盖 jitter）
    await vi.advanceTimersByTimeAsync(45000)
    expect(cb).not.toHaveBeenCalled()
    // 改版本
    rpcData.rehearsals = '2026-02-02T00:00:00'
    await vi.advanceTimersByTimeAsync(45000)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('心跳：未读数变化广播 notifications（覆盖后台新增漏报窗口）', async () => {
    vi.useFakeTimers()
    rpcData.notifications_unread = 0
    const cb = vi.fn()
    subscribeSync('notifications', cb)
    dataSyncStart()
    await vi.advanceTimersByTimeAsync(45000) // 基线，lastKnownUnread=0，不广播
    expect(cb).not.toHaveBeenCalled()
    rpcData.notifications_unread = 3
    await vi.advanceTimersByTimeAsync(45000)
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
