import { describe, it, expect } from 'vitest'
import { summarizeAttendance, type AttendanceSummaryRow } from './attendance-summary'

// 排练 2026-08-15 20:00–22:00；during = 排练进行中，after = 排练已结束
const START = '2026-08-15T20:00:00'
const END = '2026-08-15T22:00:00'
const during = new Date('2026-08-15T21:00:00')
const after = new Date('2026-08-15T22:01:00')

const row = (
  status: AttendanceSummaryRow['status'],
  signInTime: string | null = null
): AttendanceSummaryRow => ({
  status,
  sign_in_time: signInTime,
  rehearsals: { start_time: START, end_time: END },
})

describe('summarizeAttendance（考勤区间统计摘要）', () => {
  it('排练已结束后五类各计一行（含 exempt 直计）', () => {
    const s = summarizeAttendance(
      [
        row('present', '2026-08-15T20:05:00'),
        row('excused'),
        // absent 未签到，但排练已结束 → 占位解除，计缺勤
        row('absent'),
        row('exempt'),
      ],
      after
    )
    // late 历史数据并入 present，故此处 present 仍为 1
    expect(s).toEqual({ total: 4, present: 1, excused: 1, absent: 1, exempt: 1 })
  })

  it('排练进行中 exempt 未签到 → 直计 exempt（占位逻辑只对 absent 生效）', () => {
    const s = summarizeAttendance([row('exempt')], during)
    expect(s).toEqual({ total: 1, present: 0, excused: 0, absent: 0, exempt: 1 })
  })

  it('absent 占位行（未签到 + 排练未结束）不计缺勤，仅计 total', () => {
    const s = summarizeAttendance([row('absent')], during)
    expect(s).toEqual({ total: 1, present: 0, excused: 0, absent: 0, exempt: 0 })
  })

  it('status 为 null（未评定）不计任何栏目，仅计 total', () => {
    const s = summarizeAttendance([row(null)], during)
    expect(s).toEqual({ total: 1, present: 0, excused: 0, absent: 0, exempt: 0 })
  })

  it('未知/脏状态不计入任何栏目（白名单外的值不产生垃圾键）', () => {
    const s = summarizeAttendance([row('unknown' as never)], during)
    expect(s).toEqual({ total: 1, present: 0, excused: 0, absent: 0, exempt: 0 })
  })

  it('空数组 → 全零', () => {
    expect(summarizeAttendance([], during)).toEqual({
      total: 0,
      present: 0,
      excused: 0,
      absent: 0,
      exempt: 0,
    })
  })
})
