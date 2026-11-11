import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import type { PresidentAttendanceExportRow } from '@/types/database'
import {
  buildAttendanceSheets,
  buildAttendanceXlsx,
  buildUniqueSheetNames,
  sanitizeSheetName,
  type AttendanceXlsxLabels,
} from './attendance-xlsx'

const labels: AttendanceXlsxLabels = {
  name: '姓名',
  email: '邮箱',
  status: '出勤情况',
  inOrchestra: '在团情况',
  signInTime: '签到时间',
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

describe('sheet 名', () => {
  it('去掉 Excel 不允许的字符并限长 31', () => {
    expect(sanitizeSheetName('a/b:c*?"<>|')).toBe('a_b_c______')
    expect(sanitizeSheetName('   ')).toBe('rehearsal')
    expect(sanitizeSheetName('x'.repeat(60))).toHaveLength(31)
  })

  it('重名（大小写不敏感）追加 _2 / _3', () => {
    expect(buildUniqueSheetNames(['排练', '排练', 'Rehearsal', 'rehearsal'])).toEqual([
      '排练',
      '排练_2',
      'Rehearsal',
      'rehearsal_2',
    ])
  })
})

describe('buildAttendanceSheets', () => {
  it('每场一个 sheet，名字 = 曲目_日期，行按 rehearsal_id 分组', () => {
    const sheets = buildAttendanceSheets(
      [row({ rehearsal_id: 1 }), row({ rehearsal_id: 2, full_name: '李四' })],
      [
        {
          id: 1,
          start_time: '2026-08-20T19:00:00',
          repertoire: '贝五',
          title: null,
        },
        {
          id: 2,
          start_time: '2026-08-21T19:00:00',
          repertoire: '贝五',
          title: null,
        },
      ],
      '未命名排练'
    )
    expect(sheets.map((sheet) => sheet.name)).toEqual(['贝五_2026-08-20', '贝五_2026-08-21'])
    expect(sheets[0]!.rows).toHaveLength(1)
    expect(sheets[1]!.rows[0]!.full_name).toBe('李四')
  })

  it('选中的排练没有考勤行时也保留空 sheet（只有表头）', () => {
    const sheets = buildAttendanceSheets(
      [],
      [{ id: 9, start_time: null, repertoire: null, title: null }],
      '未命名排练'
    )
    expect(sheets).toHaveLength(1)
    expect(sheets[0]!.rows).toHaveLength(0)
  })
})

describe('buildAttendanceXlsx', () => {
  it('生成可解压的 xlsx：workbook 有多个 sheet，worksheet 含表头与转义后的值', () => {
    const sheets = buildAttendanceSheets(
      [
        row({ rehearsal_id: 1, full_name: '张三', status: 'exempt' }),
        row({ rehearsal_id: 2, full_name: 'A&B<C', status: 'late' }),
      ],
      [
        { id: 1, start_time: '2026-08-20T19:00:00', repertoire: '贝五', title: null },
        { id: 2, start_time: '2026-08-21T19:00:00', repertoire: '贝五', title: null },
      ],
      '未命名排练'
    )
    const bytes = buildAttendanceXlsx(sheets, labels)
    const files = unzipSync(bytes)

    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        'xl/workbook.xml',
        'xl/styles.xml',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/sheet2.xml',
      ])
    )
    const workbook = strFromU8(files['xl/workbook.xml']!)
    expect(workbook).toContain('name="贝五_2026-08-20"')
    expect(workbook).toContain('name="贝五_2026-08-21"')

    const sheet1 = strFromU8(files['xl/worksheets/sheet1.xml']!)
    expect(sheet1).toContain('姓名')
    expect(sheet1).toContain('无需出勤')
    expect(sheet1).toContain('张三')

    // XML 特殊字符必须转义，否则文件打不开
    const sheet2 = strFromU8(files['xl/worksheets/sheet2.xml']!)
    expect(sheet2).toContain('A&amp;B&lt;C')
    expect(sheet2).not.toContain('A&B<C')
  })
})
