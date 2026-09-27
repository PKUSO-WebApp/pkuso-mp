import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetErrorReportState, reportClientError } from '../error-report'

// 上报的落点：记录每次 insert 的报文，便于断言「发了什么 / 发了几次」
const insertCalls: Record<string, unknown>[] = []
let insertMode: 'ok' | 'reject' | 'throw' = 'ok'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        insertCalls.push(row)
        if (insertMode === 'throw') throw new Error('sync boom')
        if (insertMode === 'reject') return Promise.reject(new Error('async boom'))
        return Promise.resolve({ error: null })
      },
    }),
  },
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getSystemInfoSync: () => ({ platform: 'devtools' }),
    getCurrentPages: () => [{ route: 'pages/login/index' }],
  },
}))

/** 让 reportClientError 内部那条 insert promise 链跑完 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('reportClientError', () => {
  beforeEach(() => {
    insertCalls.length = 0
    insertMode = 'ok'
    __resetErrorReportState()
  })

  it('把错误写进 client_error_logs，并带上平台/页面上下文', async () => {
    reportClientError({ event: 'wechat_login', message: 'login:fail timeout', detail: { step: 'wx_login' } })
    await flush()

    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0]).toMatchObject({
      level: 'error',
      source: 'mp',
      event: 'wechat_login',
      message: 'login:fail timeout',
      detail: { step: 'wx_login' },
      platform: 'devtools',
      page: 'pages/login/index',
    })
  })

  it('同一指纹在窗口内只报一次（防循环报错写爆库）', async () => {
    reportClientError({ event: 'wechat_login', message: 'same failure' })
    reportClientError({ event: 'wechat_login', message: 'same failure' })
    reportClientError({ event: 'wechat_login', message: 'same failure' })
    await flush()

    expect(insertCalls).toHaveLength(1)
  })

  it('message 不同则视为不同错误，各自上报', async () => {
    reportClientError({ event: 'wechat_login', message: 'failure A' })
    reportClientError({ event: 'wechat_login', message: 'failure B' })
    await flush()

    expect(insertCalls).toHaveLength(2)
  })

  it('event 不同则指纹不同，同一 message 也各自上报', async () => {
    reportClientError({ event: 'wechat_login', message: 'same text' })
    reportClientError({ event: 'app_error', message: 'same text' })
    await flush()

    expect(insertCalls).toHaveLength(2)
  })

  it('message 超长截断到库端上限 500', async () => {
    reportClientError({ event: 'wechat_login', message: 'x'.repeat(900) })
    await flush()

    expect((insertCalls[0].message as string).length).toBe(500)
  })

  it('单字段超长时在归一化阶段截断，不触发整体降级', async () => {
    reportClientError({
      event: 'app_error',
      message: 'long stack',
      detail: { stack: 'y'.repeat(5000) },
    })
    await flush()

    const detail = insertCalls[0].detail as Record<string, unknown>
    expect((detail.stack as string).length).toBe(800)
    expect(detail.detail_truncated).toBeUndefined()
  })

  it('detail 超限时逐字段保留（而不是整块丢成一句 keys），且保证能写进库', async () => {
    // 单字段已在归一化时截到 800 字符，所以只有「字段足够多」才会超 4096
    const many = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`field${i}`, 'y'.repeat(800)])
    )
    reportClientError({ event: 'app_error', message: 'big detail', detail: many })
    await flush()

    const detail = insertCalls[0].detail as Record<string, unknown>
    expect(JSON.stringify(detail).length).toBeLessThanOrEqual(4096)
    expect(detail.detail_truncated).toBe(true)
    // 关键：靠前的字段仍在——调用方按重要性排列，前缀通常就够定位
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

  it('insert 同步抛错时静默（上报自身绝不能影响业务）', async () => {
    insertMode = 'throw'
    expect(() => reportClientError({ event: 'app_error', message: 'boom' })).not.toThrow()
    await flush()
  })

  it('insert 异步失败时静默（不会冒泡成 unhandledRejection 再被上报一次）', async () => {
    insertMode = 'reject'
    expect(() => reportClientError({ event: 'app_error', message: 'async boom' })).not.toThrow()
    await flush()
    // 关键：失败的上报不会触发第二次上报，否则就是「上报→失败→上报」的循环
    expect(insertCalls).toHaveLength(1)
  })
})
