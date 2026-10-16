import { describe, expect, it, vi } from 'vitest'
import { BATCH_GAP_MS, groupHistoryBatches, type HistoryEntry } from './annotation-history'

// 这个模块里还有读云端的函数（import 期就会建 supabase 客户端，而测试环境没有那套 env）。
// 用例只打纯函数，给个空壳就够 —— `vi.mock` 会被 vitest 提升到 import 之前，写法同
// `annotation-sync-runner.test.ts`。
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

const e = (page: number, replacedAt: string, version = `v${page}`): HistoryEntry => ({
  page,
  version,
  replacedAt,
})

/** 便于读断言：把批次压成 [[页…], [页…]] 与 [时刻…] */
const pages = (bs: ReturnType<typeof groupHistoryBatches>) => bs.map((b) => b.entries.map((x) => x.page))

describe('groupHistoryBatches：把「按页存」的归档聚成「一次覆盖」', () => {
  it('同一秒内的多条 ⇒ 一批（一次同步归档了好几页）', () => {
    const rows = [
      e(3, '2026-10-16T04:00:00.100Z'),
      e(1, '2026-10-16T04:00:00.050Z'),
      e(2, '2026-10-16T04:00:00.900Z'),
    ]
    expect(pages(groupHistoryBatches(rows))).toEqual([[2, 3, 1]])
  })

  it('间隔超过阈值 ⇒ 分成两批（新的那批在前）', () => {
    const rows = [
      e(5, '2026-10-16T04:00:00.000Z'),
      e(2, '2026-10-16T04:10:00.000Z'), // 10 分钟后 ⇒ 更新，排前
    ]
    expect(pages(groupHistoryBatches(rows))).toEqual([[2], [5]])
  })

  it('恰好等于阈值 ⇒ 仍算同一批（判据是 ≤）', () => {
    const t0 = Date.parse('2026-10-16T04:00:00.000Z')
    const rows = [
      e(1, new Date(t0).toISOString()),
      e(2, new Date(t0 + BATCH_GAP_MS).toISOString()),
    ]
    expect(pages(groupHistoryBatches(rows))).toEqual([[2, 1]])
  })

  it('判据是与**这一批最新**那条的间隔，不是与上一条（否则慢速滴水会串成一大批）', () => {
    // 四条各差 1 分钟：与上一条比全都 <= 2 分钟 ⇒ 会被串成一批；
    // 与本批最新那条（03 分）比，00 分那条差 3 分钟 ⇒ 必须另起一批
    const bs = groupHistoryBatches([
      e(1, '2026-10-16T04:00:00.000Z'),
      e(2, '2026-10-16T04:01:00.000Z'),
      e(3, '2026-10-16T04:02:00.000Z'),
      e(4, '2026-10-16T04:03:00.000Z'),
    ])
    expect(pages(bs)).toEqual([[4, 3, 2], [1]])
  })

  it('入参乱序也照时间降序：批次的 `at` 是这一批**最新**那条', () => {
    const bs = groupHistoryBatches([
      e(1, '2026-10-16T04:00:00.000Z'),
      e(9, '2026-10-16T05:00:00.000Z'),
      e(7, '2026-10-16T05:00:01.000Z'),
    ])
    expect(pages(bs)).toEqual([[7, 9], [1]])
    expect(bs[0]?.at).toBe('2026-10-16T05:00:01.000Z')
  })

  it('同一页的两个版本落在同一批里也要都留着（各自都是一个可恢复的版本）', () => {
    const bs = groupHistoryBatches([
      e(4, '2026-10-16T04:00:00.000Z', 'a'),
      e(4, '2026-10-16T04:00:02.000Z', 'b'),
    ])
    expect(bs[0]?.entries.map((x) => x.version)).toEqual(['b', 'a'])
  })

  it('空数组 ⇒ 空结果；不改入参', () => {
    expect(groupHistoryBatches([])).toEqual([])
    const rows = [e(1, '2026-10-16T04:00:00.000Z'), e(2, '2026-10-16T05:00:00.000Z')]
    const before = rows.map((x) => x.page)
    void groupHistoryBatches(rows)
    expect(rows.map((x) => x.page)).toEqual(before)
  })
})
