import { describe, expect, it } from 'vitest'
import {
  buildWorkbookFileName,
  filterRehearsalsByDateRange,
  formatRehearsalDateTimeLine,
  sanitizeFilePart,
} from './attendance-export'

describe('filterRehearsalsByDateRange', () => {
  const rows = [
    { id: 1, start_time: '2026-08-19T23:59:00' },
    { id: 2, start_time: '2026-08-20T00:00:00' },
    { id: 3, start_time: '2026-08-20T23:59:00' },
    { id: 4, start_time: '2026-08-21T00:00:00' },
    { id: 5, start_time: null },
  ]

  it('两端含当日，无开始时间的排练不导出', () => {
    expect(filterRehearsalsByDateRange(rows, '2026-08-20', '2026-08-20').map((r) => r.id)).toEqual([
      2, 3,
    ])
  })

  it('只填一端按该端过滤', () => {
    expect(filterRehearsalsByDateRange(rows, '', '2026-08-19').map((r) => r.id)).toEqual([1])
    expect(filterRehearsalsByDateRange(rows, '2026-08-21', '').map((r) => r.id)).toEqual([4])
  })
})

describe('文件名', () => {
  it('去掉非法字符并限长', () => {
    expect(sanitizeFilePart('a/b:c*?"<>|')).toBe('a_b_c______')
    expect(sanitizeFilePart('   ')).toBe('rehearsal')
    expect(sanitizeFilePart('x'.repeat(60))).toHaveLength(40)
  })

  it('xlsx 扩展名，优先用实际第一场 / 最后一场日期', () => {
    expect(
      buildWorkbookFileName({
        prefix: '考勤记录',
        startDate: '2026-08-20',
        endDate: '2026-08-21',
        allLabel: '全部',
      })
    ).toBe('考勤记录_2026-08-20_2026-08-21.xlsx')
    expect(
      buildWorkbookFileName({
        prefix: '考勤记录',
        startDate: '',
        endDate: '',
        allLabel: '全部',
      })
    ).toBe('考勤记录_全部_全部.xlsx')
  })
})

describe('formatRehearsalDateTimeLine', () => {
  it('日期 · 起止时间', () => {
    expect(formatRehearsalDateTimeLine('2026-08-20T19:00:00', '2026-08-20T21:30:00')).toBe(
      '2026-08-20 · 19:00 - 21:30'
    )
  })

  it('没有结束时间只显示开始', () => {
    expect(formatRehearsalDateTimeLine('2026-08-20 19:00:00', null)).toBe('2026-08-20 · 19:00')
  })
})
