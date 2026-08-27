import { describe, it, expect } from 'vitest'
import { parseLocalISO } from '@/lib/date-utils'
import type { RehearsalRow } from '@/types/database'
import {
  isRehearsalUpdated,
  isRehearsalEnded,
  isRehearsalTodayOrFuture,
  getUpdateBadgeLabel,
  sortRehearsalsForMember,
  sortEndedFullRehearsals,
} from './rehearsal-sort'

/** 构造排练行；时间用本地时间 ISO 字符串（parseLocalISO 按本地时区解析，任意时区下一致） */
function makeRehearsal(
  id: number,
  startISO: string | null,
  endISO: string | null,
  opts: { created?: string | null; updated?: string | null } = {}
): RehearsalRow {
  return {
    id,
    repertoire: `排练${id}`,
    type: 'full',
    start_time: startISO,
    end_time: endISO,
    location: '排练厅',
    title: null,
    date: null,
    time: null,
    checkin_lat: null,
    checkin_lng: null,
    checkin_radius_m: null,
    sign_in_code: null,
    target_section: null,
    created_at: opts.created ?? null,
    updated_at: opts.updated ?? '2026-08-10T00:00:00.000Z',
    updated_fields: null,
  }
}

/** 已更新：编辑时刻晚于创建时刻 */
function updated(opts: { created: string; updated: string }) {
  return { created: opts.created, updated: opts.updated }
}

/** 固定"现在"：2026-08-15 21:00（本地时间） */
const NOW = parseLocalISO('2026-08-15T21:00:00')

describe('isRehearsalUpdated', () => {
  it('updated_at 晚于 created_at 时判定为已更新', () => {
    const item = makeRehearsal(1, '2026-08-15T20:00:00', null, {
      created: '2026-08-10T00:00:00.000Z',
      updated: '2026-08-15T12:00:00.000Z',
    })
    expect(isRehearsalUpdated(item)).toBe(true)
  })

  it('updated_at 早于或等于 created_at 时判定为未更新', () => {
    const equal = makeRehearsal(1, '2026-08-15T20:00:00', null, {
      created: '2026-08-10T00:00:00.000Z',
      updated: '2026-08-10T00:00:00.000Z',
    })
    const earlier = makeRehearsal(2, '2026-08-15T20:00:00', null, {
      created: '2026-08-10T00:00:00.000Z',
      updated: '2026-08-09T00:00:00.000Z',
    })
    expect(isRehearsalUpdated(equal)).toBe(false)
    expect(isRehearsalUpdated(earlier)).toBe(false)
  })

  it('created_at 或 updated_at 缺失时判定为未更新', () => {
    const noCreated = makeRehearsal(1, '2026-08-15T20:00:00', null, {
      created: null,
      updated: '2026-08-15T12:00:00.000Z',
    })
    const noUpdated = makeRehearsal(2, '2026-08-15T20:00:00', null, {
      created: '2026-08-10T00:00:00.000Z',
      updated: '2026-08-10T00:00:00.000Z',
    })
    noUpdated.updated_at = ''
    expect(isRehearsalUpdated(noCreated)).toBe(false)
    expect(isRehearsalUpdated(noUpdated)).toBe(false)
  })
})

describe('isRehearsalEnded', () => {
  it('now 晚于 end 时判定为已结束', () => {
    // 排练 08:00-10:00，now 21:00
    const item = makeRehearsal(1, '2026-08-15T08:00:00', '2026-08-15T10:00:00')
    expect(isRehearsalEnded(item, NOW)).toBe(true)
  })

  it('now 恰好等于 end 时判定为已结束', () => {
    // 排练 20:00-21:00，now 21:00（恰在结束时刻，与"持续到排练结束"一致）
    const item = makeRehearsal(1, '2026-08-15T20:00:00', '2026-08-15T21:00:00')
    expect(isRehearsalEnded(item, NOW)).toBe(true)
  })

  it('end_time 缺失时按 start + 3 小时计', () => {
    // 排练 19:00 开始（默认 3 小时，end 22:00），now 21:00 未结束
    const ongoing = makeRehearsal(1, '2026-08-15T19:00:00', null)
    expect(isRehearsalEnded(ongoing, NOW)).toBe(false)
    // 排练 17:00 开始（end 20:00），now 21:00 已结束
    const gone = makeRehearsal(2, '2026-08-15T17:00:00', null)
    expect(isRehearsalEnded(gone, NOW)).toBe(true)
  })

  it('end_time 为无效字符串时按 start + 3 小时计', () => {
    // parseLocalISO 对无法解析的字符串退化为 1900 年附近，应回退 start + 3 小时
    // 排练 19:00 开始（回退 end 22:00），now 21:00 未结束
    const ongoing = makeRehearsal(1, '2026-08-15T19:00:00', '不是有效时间')
    expect(isRehearsalEnded(ongoing, NOW)).toBe(false)
    // 排练 17:00 开始（回退 end 20:00），now 21:00 已结束
    const gone = makeRehearsal(2, '2026-08-15T17:00:00', 'invalid')
    expect(isRehearsalEnded(gone, NOW)).toBe(true)
  })

  it('无有效 start_time 时视为未结束', () => {
    const noTime = makeRehearsal(1, null, null)
    expect(isRehearsalEnded(noTime, NOW)).toBe(false)
  })
})

describe('isRehearsalTodayOrFuture（Issue #173）', () => {
  it('今天（含当天已结束）与未来日期的排练保留', () => {
    // 今天 08:00 已结束，但日期仍是今天，保留（判定只看日期不看时刻）
    const todayEnded = makeRehearsal(1, '2026-08-15T08:00:00', '2026-08-15T10:00:00')
    const todayOngoing = makeRehearsal(2, '2026-08-15T20:00:00', null)
    const future = makeRehearsal(3, '2026-08-16T20:00:00', null)
    expect(isRehearsalTodayOrFuture(todayEnded, NOW)).toBe(true)
    expect(isRehearsalTodayOrFuture(todayOngoing, NOW)).toBe(true)
    expect(isRehearsalTodayOrFuture(future, NOW)).toBe(true)
  })

  it('过去日期的排练隐藏（哪怕仅早一天）', () => {
    const past = makeRehearsal(1, '2026-08-14T23:59:00', null)
    const longAgo = makeRehearsal(2, '2026-01-01T08:00:00', null)
    expect(isRehearsalTodayOrFuture(past, NOW)).toBe(false)
    expect(isRehearsalTodayOrFuture(longAgo, NOW)).toBe(false)
  })

  it('无 start_time 或无法解析时保守保留', () => {
    const noTime = makeRehearsal(1, null, null)
    const garbage = makeRehearsal(2, '不是有效时间', null)
    expect(isRehearsalTodayOrFuture(noTime, NOW)).toBe(true)
    expect(isRehearsalTodayOrFuture(garbage, NOW)).toBe(true)
  })

  it('跨年边界：now 为 12 月 31 日时，次年 1 月 1 日保留', () => {
    const yearEnd = parseLocalISO('2026-12-31T23:00:00')
    const newYear = makeRehearsal(1, '2027-01-01T00:00:00', null)
    const lastYear = makeRehearsal(2, '2026-12-30T20:00:00', null)
    expect(isRehearsalTodayOrFuture(newYear, yearEnd)).toBe(true)
    expect(isRehearsalTodayOrFuture(lastYear, yearEnd)).toBe(false)
  })
})

describe('sortRehearsalsForMember', () => {
  it('upcoming 组内进行中恒在未开始前，组内按 |start - now| 近 → 远', () => {
    // 进行中组：B（开始 10 分钟前）、A（开始 2 小时前）；未开始组：C（15 分钟后）、D（明天）。
    // 注意 C 距 start 比 A 近，但未开始只能排在全部进行中之后（Issue #140 返工）
    const a = makeRehearsal(1, '2026-08-15T19:00:00', '2026-08-15T21:30:00')
    const b = makeRehearsal(2, '2026-08-15T20:50:00', '2026-08-15T22:50:00')
    const c = makeRehearsal(3, '2026-08-15T21:15:00', '2026-08-15T23:15:00')
    const d = makeRehearsal(4, '2026-08-16T20:00:00', null)

    const result = sortRehearsalsForMember([a, b, c, d], NOW)
    expect(result.map((r) => r.id)).toEqual([2, 1, 3, 4])
  })

  it('进行中恒在未开始前：未开始距 start 更近也不得越过进行中（Issue #140 反例）', () => {
    // now 21:00：X 18:00-21:00 进行中（|start-now| = 3h），Y 21:30 未开始（|start-now| = 0.5h）。
    // 旧实现按 |start - now| 跨组混排输出 [Y, X]，spec 要求 [X, Y]
    const x = makeRehearsal(1, '2026-08-15T18:00:00', '2026-08-15T21:00:00')
    const y = makeRehearsal(2, '2026-08-15T21:30:00', '2026-08-15T23:30:00')

    const result = sortRehearsalsForMember([y, x], NOW)
    expect(result.map((r) => r.id)).toEqual([1, 2])
  })

  it('now 恰好等于 end 时仍算进行中（不落入 ended 组）', () => {
    // end 21:00 恰好等于 now：进行中，排最前
    const a = makeRehearsal(1, '2026-08-15T20:00:00', '2026-08-15T21:00:00')
    const b = makeRehearsal(2, '2026-08-16T20:00:00', null)

    const result = sortRehearsalsForMember([b, a], NOW)
    expect(result.map((r) => r.id)).toEqual([1, 2])
  })

  it('ended 组整组在底部，最近结束在前', () => {
    // X：未开始（明天），F：已结束（5 小时前），E：已结束（9 小时前）
    const x = makeRehearsal(1, '2026-08-16T20:00:00', null)
    const f = makeRehearsal(2, '2026-08-15T14:00:00', '2026-08-15T16:00:00')
    const e = makeRehearsal(3, '2026-08-15T10:00:00', '2026-08-15T12:00:00')

    const result = sortRehearsalsForMember([x, f, e], NOW)
    expect(result.map((r) => r.id)).toEqual([1, 2, 3])
  })

  it('更新过且非第一位 → 提到第一位之后；多个 updated 内部保持时间近 → 远', () => {
    // A（进行中，非 updated，最近）→ 第一位；B、D、C 中 B、C 已更新，提到 A 之后并保持相对顺序
    const a = makeRehearsal(1, '2026-08-15T20:00:00', null)
    const b = makeRehearsal(
      2,
      '2026-08-16T20:00:00',
      null,
      updated({ created: '2026-08-10T00:00:00.000Z', updated: '2026-08-14T00:00:00.000Z' })
    )
    const d = makeRehearsal(3, '2026-08-16T21:00:00', null)
    const c = makeRehearsal(
      4,
      '2026-08-17T20:00:00',
      null,
      updated({ created: '2026-08-10T00:00:00.000Z', updated: '2026-08-14T00:00:00.000Z' })
    )

    const result = sortRehearsalsForMember([a, b, d, c], NOW)
    expect(result.map((r) => r.id)).toEqual([1, 2, 4, 3])
  })

  it('第一位本身已更新时保持首位', () => {
    // A（进行中，最近，已更新）保持首位
    const a = makeRehearsal(
      1,
      '2026-08-15T20:00:00',
      null,
      updated({ created: '2026-08-10T00:00:00.000Z', updated: '2026-08-14T00:00:00.000Z' })
    )
    const b = makeRehearsal(2, '2026-08-16T20:00:00', null)

    const result = sortRehearsalsForMember([a, b], NOW)
    expect(result.map((r) => r.id)).toEqual([1, 2])
  })

  it('首位已更新时，其余已更新项同样置顶到首位之后（Issue #140 反例）', () => {
    // A（1h 后开始，已更新）→ 首位；B（2h 后，未更新）；C（3h 后，已更新）。
    // 旧实现因首位已更新直接跳过置顶逻辑输出 [A, B, C]，spec 要求 [A, C, B]
    const a = makeRehearsal(
      1,
      '2026-08-15T22:00:00',
      null,
      updated({ created: '2026-08-10T00:00:00.000Z', updated: '2026-08-14T00:00:00.000Z' })
    )
    const b = makeRehearsal(2, '2026-08-15T23:00:00', null)
    const c = makeRehearsal(
      3,
      '2026-08-16T00:00:00',
      null,
      updated({ created: '2026-08-10T00:00:00.000Z', updated: '2026-08-14T00:00:00.000Z' })
    )

    const result = sortRehearsalsForMember([a, b, c], NOW)
    expect(result.map((r) => r.id)).toEqual([1, 3, 2])
  })

  it('ended 组不受 updated 影响（不置顶，仍按结束时刻近 → 远）', () => {
    // F（非 updated，5 小时前结束）在前；E（已更新，9 小时前结束）不因更新而置顶
    const x = makeRehearsal(1, '2026-08-16T20:00:00', null)
    const f = makeRehearsal(2, '2026-08-15T14:00:00', '2026-08-15T16:00:00')
    const e = makeRehearsal(
      3,
      '2026-08-15T10:00:00',
      '2026-08-15T12:00:00',
      updated({ created: '2026-08-10T00:00:00.000Z', updated: '2026-08-14T00:00:00.000Z' })
    )

    const result = sortRehearsalsForMember([x, f, e], NOW)
    expect(result.map((r) => r.id)).toEqual([1, 2, 3])
  })

  it('无有效 start_time 的排练排最后、保持原相对顺序，且不修改原数组', () => {
    const n1 = makeRehearsal(1, null, null)
    const a = makeRehearsal(2, '2026-08-15T20:00:00', null)
    const n2 = makeRehearsal(3, null, null)
    const b = makeRehearsal(4, '2026-08-16T20:00:00', null)
    const input = [n1, a, n2, b]

    const result = sortRehearsalsForMember(input, NOW)
    // 无时间项排在最后，且保持彼此原相对顺序（n1 在 n2 前）
    expect(result.map((r) => r.id)).toEqual([2, 4, 1, 3])
    // 原数组未被修改（顺序与引用均不变）
    expect(input).toEqual([n1, a, n2, b])
    expect(input[0]).toBe(n1)
  })

  it('空数组返回空数组', () => {
    expect(sortRehearsalsForMember([], NOW)).toEqual([])
  })
})

describe('getUpdateBadgeLabel（Issue #171）', () => {
  /** 已更新排练（updated_at > created_at）+ 指定 updated_fields */
  function updatedItem(fields: string | null): RehearsalRow {
    const item = makeRehearsal(1, '2026-08-15T20:00:00', null, {
      created: '2026-08-10T00:00:00.000Z',
      updated: '2026-08-15T12:00:00.000Z',
    })
    return { ...item, updated_fields: fields }
  }

  it('单个字段：time/location/repertoire → 对应文案', () => {
    expect(getUpdateBadgeLabel(updatedItem('time'))).toBe('更新排练时间')
    expect(getUpdateBadgeLabel(updatedItem('location'))).toBe('更新排练地点')
    expect(getUpdateBadgeLabel(updatedItem('repertoire'))).toBe('更新排练曲目')
  })

  it('多字段按 time/location/repertoire 顺序拼接（与写入顺序无关）', () => {
    expect(getUpdateBadgeLabel(updatedItem('time,location'))).toBe('更新排练时间/地点')
    expect(getUpdateBadgeLabel(updatedItem('time,repertoire'))).toBe('更新排练时间/曲目')
    expect(getUpdateBadgeLabel(updatedItem('time,location,repertoire'))).toBe(
      '更新排练时间/地点/曲目'
    )
    // 触发器按字段比较写入固定顺序，但函数不依赖写入顺序
    expect(getUpdateBadgeLabel(updatedItem('repertoire,time'))).toBe('更新排练时间/曲目')
  })

  it("仅含 'other' 哨兵（只改过 sign_in_code 等非细分字段）→ null，不显示更新提示", () => {
    expect(getUpdateBadgeLabel(updatedItem('other'))).toBeNull()
    // 防御：未知字段 + 'other'（仍无细分字段）同样不显示
    expect(getUpdateBadgeLabel(updatedItem('sign_in_code,other'))).toBeNull()
    // 含空格变体（逗号后带空格）
    expect(getUpdateBadgeLabel(updatedItem('other, '))).toBeNull()
  })

  it("细分字段与 'other' 哨兵共存时忽略 'other'，正常拼接细分文案", () => {
    expect(getUpdateBadgeLabel(updatedItem('time,other'))).toBe('更新排练时间')
    expect(getUpdateBadgeLabel(updatedItem('other,time,repertoire'))).toBe('更新排练时间/曲目')
  })

  it('累积语义：多次编辑的字段并集同样正确拼接（顺序固定，与编辑次数无关）', () => {
    // 第一次编辑改 time，第二次改 location（并集 time,location）
    expect(getUpdateBadgeLabel(updatedItem('time,location'))).toBe('更新排练时间/地点')
    // 编辑过细分字段后又只改过非细分字段（并入 'other'），细分文案不受影响
    expect(getUpdateBadgeLabel(updatedItem('time,other,repertoire'))).toBe('更新排练时间/曲目')
    // 细分字段全部改过 + 'other'：忽略 'other' 输出全量文案
    expect(getUpdateBadgeLabel(updatedItem('time,location,repertoire,other'))).toBe(
      '更新排练时间/地点/曲目'
    )
  })

  it('updated_fields 为 null/空但已更新（存量数据）→ 兜底全量文案', () => {
    expect(getUpdateBadgeLabel(updatedItem(null))).toBe('更新排练时间/地点/曲目')
    expect(getUpdateBadgeLabel(updatedItem(''))).toBe('更新排练时间/地点/曲目')
  })

  it('未更新（updated_at <= created_at）→ null', () => {
    const notUpdated = makeRehearsal(1, '2026-08-15T20:00:00', null, {
      created: '2026-08-10T00:00:00.000Z',
      updated: '2026-08-10T00:00:00.000Z',
    })
    expect(getUpdateBadgeLabel(notUpdated)).toBeNull()
  })

  it('updated_fields 含未知字段时忽略未知字段；仅未知字段时回退到 isRehearsalUpdated 判定', () => {
    // 已知 + 未知混合：只拼已知字段
    expect(getUpdateBadgeLabel(updatedItem('time,sign_in_code'))).toBe('更新排练时间')
    // 仅未知字段（非 'other' 哨兵，新触发器不会产出，纯防御路径）：视为无字段信息，
    // 回退 isRehearsalUpdated（该排练已更新 → 兜底文案）
    expect(getUpdateBadgeLabel(updatedItem('sign_in_code'))).toBe('更新排练时间/地点/曲目')
  })

  it('created_at/updated_at 缺失且 updated_fields 为空 → null（无更新时间可判定）', () => {
    const noTimes = makeRehearsal(1, '2026-08-15T20:00:00', null, {
      created: null,
      updated: '2026-08-15T12:00:00.000Z',
    })
    expect(getUpdateBadgeLabel(noTimes)).toBeNull()
  })
})

describe('sortEndedFullRehearsals', () => {
  it('仅保留 type=full 且已结束的排练，分排/进行中/未开始均不出现', () => {
    const ended = makeRehearsal(1, '2026-08-15T08:00:00', '2026-08-15T10:00:00')
    const inProgress = makeRehearsal(2, '2026-08-15T20:00:00', '2026-08-15T22:00:00')
    const upcoming = makeRehearsal(3, '2026-08-16T20:00:00', null)
    const section = {
      ...makeRehearsal(4, '2026-08-15T08:00:00', '2026-08-15T10:00:00'),
      type: 'section',
    } as RehearsalRow

    const result = sortEndedFullRehearsals([section, upcoming, inProgress, ended], NOW)
    expect(result.map((r) => r.id)).toEqual([1])
  })

  it('now 恰好等于 end 时判定为已结束（与 isRehearsalEnded 一致）', () => {
    // 排练 20:00-21:00，now 21:00 恰在结束时刻
    const item = makeRehearsal(1, '2026-08-15T20:00:00', '2026-08-15T21:00:00')
    expect(sortEndedFullRehearsals([item], NOW).map((r) => r.id)).toEqual([1])
  })

  it('end_time 缺失时按 start + 3 小时判定', () => {
    // 17:00 开始（默认 end 20:00），now 21:00 已结束
    const gone = makeRehearsal(1, '2026-08-15T17:00:00', null)
    // 19:00 开始（默认 end 22:00），now 21:00 未结束
    const ongoing = makeRehearsal(2, '2026-08-15T19:00:00', null)

    const result = sortEndedFullRehearsals([ongoing, gone], NOW)
    expect(result.map((r) => r.id)).toEqual([1])
  })

  it('无有效 start_time 的排练不出现', () => {
    const noTime = makeRehearsal(1, null, null)
    expect(sortEndedFullRehearsals([noTime], NOW)).toEqual([])
  })

  it('按结束时刻近 → 远排序（最近结束在前）', () => {
    // A：11 小时前结束；B：5 小时前结束；C：很早前结束
    const a = makeRehearsal(1, '2026-08-15T08:00:00', '2026-08-15T10:00:00')
    const b = makeRehearsal(2, '2026-08-15T14:00:00', '2026-08-15T16:00:00')
    const c = makeRehearsal(3, '2026-07-20T08:00:00', '2026-07-20T10:00:00')

    const result = sortEndedFullRehearsals([a, c, b], NOW)
    expect(result.map((r) => r.id)).toEqual([2, 1, 3])
  })

  it('不限时间窗口：任意历史时刻的已结束合排都保留，且不修改原数组', () => {
    const old = makeRehearsal(1, '2026-01-01T08:00:00', '2026-01-01T10:00:00')
    const input = [old]

    const result = sortEndedFullRehearsals(input, NOW)
    expect(result.map((r) => r.id)).toEqual([1])
    // 原数组未被修改（顺序与引用均不变）
    expect(input).toEqual([old])
    expect(input[0]).toBe(old)
  })

  it('空数组返回空数组', () => {
    expect(sortEndedFullRehearsals([], NOW)).toEqual([])
  })
})
