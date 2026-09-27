import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetErrorReportState, flushErrorQueue, reportClientError } from '../error-report'

// 本地 storage（队列就存在这里）
const storage = new Map<string, string>()
// 每次 insert 调用的报文数组
const insertCalls: Record<string, unknown>[][] = []
let insertMode: 'ok' | 'reject' | 'server_error' | 'throw' = 'ok'

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: (key: string) => storage.get(key) ?? '',
    setStorageSync: (key: string, value: string) => {
      storage.set(key, value)
    },
    removeStorageSync: (key: string) => {
      storage.delete(key)
    },
    getSystemInfoSync: () => ({ platform: 'devtools' }),
    getCurrentPages: () => [{ route: 'pages/login/index' }],
  },
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      insert: (rows: unknown) => {
        const batch = (Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[]
        insertCalls.push(batch)
        if (insertMode === 'throw') throw new Error('sync boom')
        if (insertMode === 'reject') return Promise.reject(new Error('network down'))
        if (insertMode === 'server_error') {
          return Promise.resolve({ error: { message: 'check constraint violated' } })
        }
        return Promise.resolve({ error: null })
      },
    }),
  },
}))

/** 让 reportClientError / flushErrorQueue 内部的 promise 链跑完 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const readQueue = (): Record<string, unknown>[] =>
  JSON.parse(storage.get('pkuso_error_queue') ?? '[]')

describe('reportClientError', () => {
  beforeEach(() => {
    storage.clear()
    insertCalls.length = 0
    insertMode = 'ok'
    __resetErrorReportState()
  })

  // --- 基本写入 ---

  it('把错误写进 client_error_logs，并带上平台/页面上下文', async () => {
    reportClientError({
      event: 'wechat_login',
      message: 'login:fail timeout',
      detail: { step: 'wx_login' },
    })
    await flush()

    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0][0]).toMatchObject({
      level: 'error',
      source: 'mp',
      event: 'wechat_login',
      message: 'login:fail timeout',
      detail: { step: 'wx_login' },
      platform: 'devtools',
      page: 'pages/login/index',
    })
  })

  it('记录的是「发生时刻」而不是发送时刻', async () => {
    const before = Date.now()
    reportClientError({ event: 'app_error', message: 'timestamped' })
    await flush()

    const sent = insertCalls[0][0].created_at as string
    const t = Date.parse(sent)
    expect(Number.isFinite(t)).toBe(true)
    expect(t).toBeGreaterThanOrEqual(before)
  })

  // --- 本地队列：断网不丢 ---

  it('网络不通时记录留在本地队列（不丢）', async () => {
    insertMode = 'reject'
    reportClientError({ event: 'wechat_login', message: 'offline failure' })
    await flush()

    expect(insertCalls).toHaveLength(1) // 试过了
    const queued = readQueue()
    expect(queued).toHaveLength(1) // 但留在队列里
    expect(queued[0].message).toBe('offline failure')
  })

  it('网络恢复后补送成功并清空队列', async () => {
    insertMode = 'reject'
    reportClientError({ event: 'wechat_login', message: 'cached failure' })
    await flush()
    expect(readQueue()).toHaveLength(1)

    insertMode = 'ok'
    flushErrorQueue()
    await flush()

    expect(readQueue()).toHaveLength(0)
    // 补送的那一批带上了积压的记录
    const lastBatch = insertCalls[insertCalls.length - 1]
    expect(lastBatch).toHaveLength(1)
    expect(lastBatch[0].message).toBe('cached failure')
  })

  it('断网期间多条记录一起补送', async () => {
    insertMode = 'reject'
    reportClientError({ event: 'wechat_login', message: 'failure A' })
    reportClientError({ event: 'send_login_code', message: 'failure B' })
    await flush()
    expect(readQueue()).toHaveLength(2)

    insertMode = 'ok'
    flushErrorQueue()
    await flush()

    const lastBatch = insertCalls[insertCalls.length - 1]
    expect(lastBatch.map((r) => r.message).sort()).toEqual(['failure A', 'failure B'])
    expect(readQueue()).toHaveLength(0)
  })

  it('服务端拒绝时整批丢弃——毒丸不能永久堵住队列', async () => {
    insertMode = 'server_error'
    reportClientError({ event: 'app_error', message: 'poison' })
    await flush()

    expect(readQueue()).toHaveLength(0)
  })

  it('队列超限时丢最旧的，保留最新的', async () => {
    insertMode = 'reject'
    for (let i = 0; i < 55; i += 1) {
      reportClientError({ event: 'q', message: `m${i}` })
    }
    await flush()

    const queued = readQueue()
    expect(queued).toHaveLength(50)
    // 前 5 条（m0..m4）被丢掉，队列头是 m5
    expect(queued[0].message).toBe('m5')
    expect(queued[queued.length - 1].message).toBe('m54')
  })

  // --- 去重 ---

  it('同一指纹在窗口内只报一次（防循环报错写爆库）', async () => {
    reportClientError({ event: 'wechat_login', message: 'same failure' })
    reportClientError({ event: 'wechat_login', message: 'same failure' })
    reportClientError({ event: 'wechat_login', message: 'same failure' })
    await flush()

    expect(insertCalls).toHaveLength(1)
  })

  it('message 不同则视为不同错误，最终都送达', async () => {
    reportClientError({ event: 'wechat_login', message: 'failure A' })
    reportClientError({ event: 'wechat_login', message: 'failure B' })
    await flush()
    // 第二条是在第一条 flush 期间入队的，会留到下一次补送（这是队列的正常合并行为）
    flushErrorQueue()
    await flush()

    const allSent = insertCalls.flat()
    expect(allSent.map((r) => r.message).sort()).toEqual(['failure A', 'failure B'])
  })

  it('event 不同则指纹不同，同一 message 也各自送达', async () => {
    reportClientError({ event: 'wechat_login', message: 'same text' })
    reportClientError({ event: 'app_error', message: 'same text' })
    await flush()
    flushErrorQueue()
    await flush()

    const allSent = insertCalls.flat()
    expect(allSent.map((r) => r.event).sort()).toEqual(['app_error', 'wechat_login'])
  })

  it('flush 期间新入队的记录不会被误清（只移除真正送出的那些）', async () => {
    reportClientError({ event: 'wechat_login', message: 'first' })
    // 此刻第一次 insert 还挂着（promise 未 resolve）
    reportClientError({ event: 'wechat_login', message: 'second' })
    await flush()

    // second 没被发送，但必须还在队列里——不能被「清空队列」抹掉
    const queued = readQueue()
    expect(queued.map((r) => r.message)).toEqual(['second'])
  })

  // --- 字段限幅 ---

  it('message 超长截断到库端上限 500', async () => {
    reportClientError({ event: 'wechat_login', message: 'x'.repeat(900) })
    await flush()

    expect((insertCalls[0][0].message as string).length).toBe(500)
  })

  it('单字段超长时在归一化阶段截断，不触发整体降级', async () => {
    reportClientError({
      event: 'app_error',
      message: 'long stack',
      detail: { stack: 'y'.repeat(5000) },
    })
    await flush()

    const detail = insertCalls[0][0].detail as Record<string, unknown>
    expect((detail.stack as string).length).toBe(800)
    expect(detail.detail_truncated).toBeUndefined()
  })

  it('detail 超限时逐字段保留（而不是整块丢成一句 keys），且保证能写进库', async () => {
    const many = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`field${i}`, 'y'.repeat(800)])
    )
    reportClientError({ event: 'app_error', message: 'big detail', detail: many })
    await flush()

    const detail = insertCalls[0][0].detail as Record<string, unknown>
    expect(JSON.stringify(detail).length).toBeLessThanOrEqual(4096)
    expect(detail.detail_truncated).toBe(true)
    expect(detail.field0).toBeTruthy()
  })

  it('detail 里的不可序列化值不会让上报炸掉', async () => {
    reportClientError({
      event: 'app_error',
      message: 'weird detail',
      detail: { fn: () => undefined, sym: Symbol('s'), nested: { deep: undefined } },
    })
    await flush()

    expect(insertCalls).toHaveLength(1)
    expect(() => JSON.stringify(insertCalls[0])).not.toThrow()
  })

  // --- 静默 ---

  it('insert 同步抛错时静默，且不会卡住后续 flush', async () => {
    insertMode = 'throw'
    expect(() => reportClientError({ event: 'app_error', message: 'sync boom' })).not.toThrow()
    await flush()
    // 没送出去，记录留在队列
    expect(readQueue()).toHaveLength(1)

    // 关键：flushing 守卫必须已复位，否则后面所有补送都会被跳过
    insertMode = 'ok'
    flushErrorQueue()
    await flush()
    expect(readQueue()).toHaveLength(0)
  })

  it('上报失败不会冒泡成未处理拒绝（否则会被 onUnhandledRejection 再抓一次）', async () => {
    insertMode = 'reject'
    expect(() => reportClientError({ event: 'app_error', message: 'async boom' })).not.toThrow()
    await flush()
    // 关键：只有那一次尝试，没有形成「上报→失败→上报」的循环
    expect(insertCalls).toHaveLength(1)
  })
})
