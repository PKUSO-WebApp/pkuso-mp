import { localDateKey } from '@/lib/attendance-calendar'
import { pinyinSortKey } from '@/lib/pinyin-sort'
import type { AttendanceStatus, PresidentAttendanceExportRow } from '@/types/database'

/**
 * 团长排练考勤的导出（CSV）。
 *
 * 为什么是 CSV 而不是 web 端的 xlsx：小程序主包体积敏感，xlsx 的浏览器构建放不进来；
 * 后端 `president_attendance_export` 的注释也明确写着「CSV 由客户端生成」。
 * Excel / WPS 都能直接打开带 BOM 的 UTF-8 CSV。
 *
 * 本文件保持纯函数（不 import Taro / supabase），便于单测。
 */

export type AttendanceCsvLabels = {
  /** 单场表头（与 web 单场导出一致） */
  name: string
  email: string
  status: string
  inOrchestra: string
  signInTime: string
  /** 区间合并导出多出来的一列 */
  rehearsal: string
  statusLabels: Record<AttendanceStatus, string>
  inOrchestraValue: string
  notInOrchestraValue: string
  unknown: string
}

const BOM = String.fromCharCode(0xfeff)
const EOL = '\r\n'

/** CSV 单元格：含逗号 / 引号 / 换行时加引号，内部引号翻倍 */
export function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function nameOf(row: PresidentAttendanceExportRow): string {
  return (row.full_name ?? '').trim()
}

function compareName(a: PresidentAttendanceExportRow, b: PresidentAttendanceExportRow): number {
  const an = nameOf(a)
  const bn = nameOf(b)
  const ka = pinyinSortKey(an)
  const kb = pinyinSortKey(bn)
  if (ka !== kb) return ka < kb ? -1 : 1
  if (an !== bn) return an < bn ? -1 : 1
  return 0
}

function sortRowsByName(rows: PresidentAttendanceExportRow[]): PresidentAttendanceExportRow[] {
  return [...rows].sort(compareName)
}

function statusText(row: PresidentAttendanceExportRow, labels: AttendanceCsvLabels): string {
  if (!row.status) return labels.unknown
  return labels.statusLabels[row.status] ?? labels.unknown
}

function inOrchestraText(row: PresidentAttendanceExportRow, labels: AttendanceCsvLabels): string {
  if (row.is_in_orchestra === true) return labels.inOrchestraValue
  if (row.is_in_orchestra === false) return labels.notInOrchestraValue
  return labels.unknown
}

/** 单场排练的考勤表：列与 web 端单场导出一致 */
export function buildSingleAttendanceCsv(
  rows: PresidentAttendanceExportRow[],
  labels: AttendanceCsvLabels
): string {
  const table = [
    [labels.name, labels.email, labels.status, labels.inOrchestra, labels.signInTime],
    ...sortRowsByName(rows).map((row) => [
      nameOf(row) || labels.unknown,
      row.email ?? labels.unknown,
      statusText(row, labels),
      inOrchestraText(row, labels),
      row.sign_in_time ?? labels.unknown,
    ]),
  ]
  return BOM + table.map((line) => line.map(csvCell).join(',')).join(EOL)
}

/**
 * 区间合并的考勤表：CSV 没有多 sheet，所以多一列「排练」用来区分场次。
 * 行顺序与 web 的排练顺序一致（开始时间倒序），同场按姓名拼音。
 */
export function buildAllAttendanceCsv(
  rows: PresidentAttendanceExportRow[],
  labels: AttendanceCsvLabels
): string {
  const sorted = [...rows].sort((a, b) => {
    const as = a.rehearsal_start ?? ''
    const bs = b.rehearsal_start ?? ''
    if (as !== bs) return as < bs ? 1 : -1
    return compareName(a, b)
  })
  const table = [
    [
      labels.rehearsal,
      labels.name,
      labels.email,
      labels.status,
      labels.inOrchestra,
      labels.signInTime,
    ],
    ...sorted.map((row) => [
      [row.rehearsal_repertoire || row.rehearsal_title || labels.unknown, row.rehearsal_start]
        .filter(Boolean)
        .join(' '),
      nameOf(row) || labels.unknown,
      row.email ?? labels.unknown,
      statusText(row, labels),
      inOrchestraText(row, labels),
      row.sign_in_time ?? labels.unknown,
    ]),
  ]
  return BOM + table.map((line) => line.map(csvCell).join(',')).join(EOL)
}

/** 与 web 的日期筛选同一判据：按排练开始日期的 YYYY-MM-DD 比较（两端含当日） */
export function filterRehearsalsByDateRange<T extends { start_time: string | null }>(
  rows: T[],
  startDate: string,
  endDate: string
): T[] {
  return rows.filter((row) => {
    const key = localDateKey(row.start_time)
    if (!key) return false
    if (startDate && key < startDate) return false
    if (endDate && key > endDate) return false
    return true
  })
}

export function groupExportRowsByRehearsal(
  rows: PresidentAttendanceExportRow[]
): Map<number, PresidentAttendanceExportRow[]> {
  const map = new Map<number, PresidentAttendanceExportRow[]>()
  for (const row of rows) {
    const list = map.get(row.rehearsal_id) ?? []
    list.push(row)
    map.set(row.rehearsal_id, list)
  }
  return map
}

/** 文件名片段：去掉路径分隔符与 Windows/微信不允许的字符，并限长 */
export function sanitizeFilePart(value: string, fallback = 'rehearsal'): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
    .trim()
  return cleaned || fallback
}

export function buildSingleExportFileName(opts: {
  prefix: string
  title: string
  date: string | null
}): string {
  const title = sanitizeFilePart(opts.title)
  const parts = [opts.prefix, title, opts.date].filter(Boolean)
  return `${parts.join('_')}.csv`
}

export function buildAllExportFileName(opts: {
  prefix: string
  startDate: string
  endDate: string
  allLabel: string
}): string {
  const start = opts.startDate || opts.allLabel
  const end = opts.endDate || opts.allLabel
  return `${opts.prefix}_${sanitizeFilePart(start)}_${sanitizeFilePart(end)}.csv`
}

/** 排练卡片的日期行（与 web 的 `YYYY-MM-DD · HH:mm - HH:mm` 同形） */
export function formatRehearsalDateTimeLine(
  startValue: string | null,
  endValue: string | null
): string {
  const date = localDateKey(startValue)
  if (!date || !startValue) return startValue ?? ''
  const startTime = timePart(startValue)
  const endTime = endValue ? timePart(endValue) : ''
  return `${date} · ${startTime}${endTime ? ` - ${endTime}` : ''}`
}

function timePart(value: string): string {
  const m = /[T ](\d{2}):(\d{2})/.exec(value)
  return m ? `${m[1]}:${m[2]}` : ''
}
