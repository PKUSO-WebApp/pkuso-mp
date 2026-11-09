import { describe, expect, it } from 'vitest'
import {
  addMonths,
  computeAttendanceStats,
  dayTone,
  groupRowsByDate,
  localDateKey,
  monthGrid,
  monthOfDateKey,
  type AttendanceRowLike,
} from './attendance-calendar'

const NOW = new Date('2026-10-15T12:00:00').getTime()

const row = (
  status: AttendanceRowLike['status'],
  start: string | null
): AttendanceRowLike => ({
  status,
  rehearsals: { start_time: start },
})

describe('localDateKey / monthOfDateKey', () => {
  it('ISO → 本地日期键；非法值返回 null', () => {
    expect(localDateKey('2026-10-22T10:00:00')).toBe('2026-10-22')
    expect(localDateKey(null)).toBeNull()
    expect(localDateKey('not-a-date')).toBeNull()
  })

  it('同时接受空格分隔的本地时间（旧 JSCore 上 Date.parse 会失败）', () => {
    expect(localDateKey('2026-10-08 19:00:00')).toBe('2026-10-08')
    expect(dayTone([row('absent', '2026-10-08 19:00:00')], NOW)).toBe('danger')
  })

  it('日期键 → 年/月；不合法返回 null', () => {
    expect(monthOfDateKey('2026-10-22')).toEqual({ year: 2026, month: 9 })
    expect(monthOfDateKey('2026-13-01')).toBeNull()
    expect(monthOfDateKey('garbage')).toBeNull()
  })
})

describe('groupRowsByDate', () => {
  it('按本地日期分组；一天多场按开始时间升序', () => {
    const a = row('present', '2026-10-22T19:00:00')
    const b = row('absent', '2026-10-22T09:00:00')
    const c = row('excused', '2026-10-23T19:00:00')
    const map = groupRowsByDate([a, b, c])

    expect([...map.keys()]).toEqual(['2026-10-22', '2026-10-23'])
    expect(map.get('2026-10-22')?.map((r) => r.status)).toEqual(['absent', 'present'])
  })

  it('没有开始时间的行被忽略', () => {
    expect(groupRowsByDate([row('present', null)]).size).toBe(0)
  })
})

describe('dayTone：日历阴影', () => {
  it('未来 / 无需出勤 → 无阴影', () => {
    expect(dayTone([row('absent', '2026-10-20T19:00:00')], NOW)).toBeNull()
    expect(dayTone([row('exempt', '2026-10-10T19:00:00')], NOW)).toBeNull()
  })

  it('过去单场按状态取色', () => {
    expect(dayTone([row('present', '2026-10-10T19:00:00')], NOW)).toBe('success')
    expect(dayTone([row('late', '2026-10-10T19:00:00')], NOW)).toBe('warning')
    expect(dayTone([row('excused', '2026-10-10T19:00:00')], NOW)).toBe('info')
    expect(dayTone([row('absent', '2026-10-10T19:00:00')], NOW)).toBe('danger')
    expect(dayTone([row(null, '2026-10-10T19:00:00')], NOW)).toBe('danger')
  })

  it('一天多场取最严重：缺席 > 请假 > 迟到 > 出勤', () => {
    expect(
      dayTone(
        [
          row('present', '2026-10-10T19:00:00'),
          row('excused', '2026-10-10T10:00:00'),
          row('absent', '2026-10-10T14:00:00'),
        ],
        NOW
      )
    ).toBe('danger')

    expect(
      dayTone(
        [
          row('present', '2026-10-10T19:00:00'),
          row('excused', '2026-10-10T10:00:00'),
        ],
        NOW
      )
    ).toBe('info')
  })

  it('未来场的缺席不污染当天（只看已过去的场次）', () => {
    expect(
      dayTone(
        [
          row('present', '2026-10-10T19:00:00'),
          row('absent', '2026-10-20T19:00:00'),
        ],
        NOW
      )
    ).toBe('success')
  })
})

describe('computeAttendanceStats：出勤占比', () => {
  it('排除未来与 exempt；late 归入出勤；null 按缺席', () => {
    const stats = computeAttendanceStats(
      [
        row('present', '2026-10-10T19:00:00'),
        row('late', '2026-10-11T19:00:00'),
        row('absent', '2026-10-12T19:00:00'),
        row('excused', '2026-10-13T19:00:00'),
        row('exempt', '2026-10-14T19:00:00'),
        row('absent', '2026-10-20T19:00:00'), // 未来
        row(null, '2026-10-09T19:00:00'),
      ],
      NOW
    )

    expect(stats).toEqual({ present: 2, absent: 2, excused: 1, total: 5 })
  })

  it('没有任何应出勤场次 → total=0', () => {
    expect(computeAttendanceStats([row('exempt', '2026-10-14T19:00:00')], NOW)).toEqual({
      present: 0,
      absent: 0,
      excused: 0,
      total: 0,
    })
  })
})

describe('monthGrid / addMonths', () => {
  it('月历：周日起始、前后补白、格子是 7 的倍数', () => {
    const cells = monthGrid(2026, 9) // 2026-10
    const leading = new Date(2026, 9, 1).getDay()
    expect(cells.length % 7).toBe(0)
    expect(cells[leading]).toBe('2026-10-01')
    expect(cells.filter(Boolean)).toHaveLength(31)
    expect(cells.filter(Boolean).at(-1)).toBe('2026-10-31')
  })

  it('跨年加减', () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month: 0 })
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month: 11 })
  })
})
