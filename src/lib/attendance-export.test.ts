import { describe, expect, it } from 'vitest'
import type { PresidentAttendanceExportRow } from '@/types/database'
import {
  buildAllAttendanceCsv,
  buildAllExportFileName,
  buildSingleAttendanceCsv,
  buildSingleExportFileName,
  csvCell,
  filterRehearsalsByDateRange,
  formatRehearsalDateTimeLine,
  groupExportRowsByRehearsal,
  sanitizeFilePart,
  type AttendanceCsvLabels,
} from './attendance-export'

const labels: AttendanceCsvLabels = {
  name: '姓名',
  email: '邮箱',
  status: '出勤情况',
  inOrchestra: '在团情况',
  signInTime: '签到时间',
  rehearsal: '排练',
  statusLabels: {
    present: '出席',
    late: '迟到',
    absent: '缺勤',
    excused: '请假',
    exempt: '无需出勤',
  },
  inOrchestraValue: '在团',
  notInOrchestraValue: '不在团',
  unknown: '—',
}

function row(overrides: Partial<PresidentAttendanceExportRow> = {}): PresidentAttendanceExportRow {
  return {
    rehearsal_id: 1,
    rehearsal_start: '2026-08-20T19:00:00',
    rehearsal_end: '2026-08-20T21:00:00',
    rehearsal_type: 'full',
    rehearsal_title: '',
    rehearsal_repertoire: '贝多芬第五交响曲',
    rehearsal_location: '新太阳',
    user_id: 'u1',
    full_name: '张三',
    email: 'zhangsan@example.com',
    instrument: '小提琴',
    is_in_orchestra: true,
    status: 'present',
    sign_in_time: '2026-08-20T19:05:00',
    updated_at: '2026-08-20T19:05:00+00',
    ...overrides,
  }
}

describe('csvCell', () => {
  it('普通值原样输出', () => {
    expect(csvCell('张三')).toBe('张三')
    expect(csvCell(null)).toBe('')
  })

  it('逗号 / 引号 / 换行加引号并翻倍内部引号', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('a\nb')).toBe('"a\nb"')
  })
})

describe('buildSingleAttendanceCsv', () => {
  it('带 BOM、web 同款表头，并按姓名拼音排序', () => {
    const csv = buildSingleAttendanceCsv(
      [row({ full_name: '张三', user_id: 'u1' }), row({ full_name: '李四', user_id: 'u2' })],
      labels
    )
    expect(csv.startsWith(String.fromCharCode(0xfeff))).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('姓名,邮箱,出勤情况,在团情况,签到时间')
    // 李(l) 在 张(z) 前
    expect(lines[1]).toContain('李四')
    expect(lines[2]).toContain('张三')
  })

  it('exempt / late 输出中文，null 在团情况输出 —', () => {
    const csv = buildSingleAttendanceCsv(
      [
        row({
          full_name: '甲',
          status: 'exempt',
          is_in_orchestra: null as unknown as boolean,
        }),
        row({ full_name: '乙', status: 'late', is_in_orchestra: false }),
      ],
      labels
    )
    const lines = csv.slice(1).split('\r\n')
    expect(lines[1]).toContain('无需出勤')
    expect(lines[1]).toContain('—')
    expect(lines[2]).toContain('迟到')
    expect(lines[2]).toContain('不在团')
  })
})

describe('buildAllAttendanceCsv', () => {
  it('多一列「排练」，按开始时间倒序', () => {
    const csv = buildAllAttendanceCsv(
      [
        row({ rehearsal_id: 1, rehearsal_start: '2026-08-20T19:00:00', full_name: '甲' }),
        row({ rehearsal_id: 2, rehearsal_start: '2026-08-21T19:00:00', full_name: '乙' }),
      ],
      labels
    )
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('排练,姓名,邮箱,出勤情况,在团情况,签到时间')
    expect(lines[1]).toContain('2026-08-21T19:00:00')
    expect(lines[1]).toContain('乙')
    expect(lines[2]).toContain('2026-08-20T19:00:00')
  })
})

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

describe('groupExportRowsByRehearsal', () => {
  it('按 rehearsal_id 分组', () => {
    const map = groupExportRowsByRehearsal([
      row({ rehearsal_id: 1 }),
      row({ rehearsal_id: 2 }),
      row({ rehearsal_id: 1 }),
    ])
    expect(map.get(1)).toHaveLength(2)
    expect(map.get(2)).toHaveLength(1)
  })
})

describe('文件名', () => {
  it('去掉非法字符并限长', () => {
    expect(sanitizeFilePart('a/b:c*?"<>|')).toBe('a_b_c______')
    expect(sanitizeFilePart('   ')).toBe('rehearsal')
    expect(sanitizeFilePart('x'.repeat(60))).toHaveLength(40)
  })

  it('单场与区间文件名', () => {
    expect(
      buildSingleExportFileName({
        prefix: '考勤记录',
        title: '贝五/第一乐章',
        date: '2026-08-20',
      })
    ).toBe('考勤记录_贝五_第一乐章_2026-08-20.csv')
    expect(
      buildAllExportFileName({
        prefix: '考勤记录',
        startDate: '',
        endDate: '',
        allLabel: '全部',
      })
    ).toBe('考勤记录_全部_全部.csv')
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
