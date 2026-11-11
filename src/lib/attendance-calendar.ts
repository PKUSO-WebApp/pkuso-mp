import type { StatusTone } from '@/components/ui/StatusChip'

/**
 * 成员考勤日历的纯逻辑（0.6.2）。
 *
 * 与页面分开的原因：日期分组、当天最严重状态、出勤占比这三件事都是**可单测的规则**，
 * 放在 400 行的页面里只能靠真机试。这里不 import supabase / Taro。
 */

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused' | 'exempt'

/** 页面/日历只关心「状态 + 排练开始时间」；用结构类型，避免把完整行拖进来 */
export type AttendanceRowLike = {
  status: AttendanceStatus | null
  rehearsals: { start_time: string | null } | null
}

/**
 * 编辑可选状态（0.6.2）：
 * - 去掉 exempt（产品明确要求）；
 * - 去掉 late（产品已抛弃迟到；存量 late 仍按「出勤」统计与展示）。
 */
export const ATTENDANCE_EDIT_OPTIONS = ['present', 'absent', 'excused'] as const
export type AttendanceEditStatus = (typeof ATTENDANCE_EDIT_OPTIONS)[number]

/**
 * 团长直改的可选状态：全部 attendanceStatus。
 * 与声部长/首席不同——团长可以覆盖系统计算的 exempt，也可以改存量 late
 * （用户 2026-11-11：「团长应当什么都能改」）。
 */
export const ATTENDANCE_ALL_STATUSES = ['present', 'late', 'absent', 'excused', 'exempt'] as const
export type AttendanceAllStatus = (typeof ATTENDANCE_ALL_STATUSES)[number]

/** 状态 → StatusChip 色板；late 保留给存量数据展示 */
export const ATTENDANCE_TONE: Record<AttendanceStatus, StatusTone> = {
  present: 'success',
  late: 'warning',
  absent: 'danger',
  excused: 'info',
  exempt: 'neutral',
}

const SEVERITY: Record<StatusTone, number> = {
  danger: 4,
  info: 3,
  warning: 2,
  success: 1,
  neutral: 0,
}

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * 解析本地时间字符串（`YYYY-MM-DDTHH:mm:ss` 或空格分隔）。
 *
 * ⚠️ **不要用 `new Date(str)` / `Date.parse(str)`**：同一份 `2026-11-08T19:00:00`
 * 在部分旧 JSCore（iOS 微信）上会解析失败，而在 Chrome 上正常 —— 那会导致某些排练
 * （尤其是分排）在日历里整行消失。`lib/date-utils` 的 `parseLocalISO` 早就是为这件事
 * 存在的；这里实现同一套规则，但不 import 它（那会经 i18n 把 Taro 拖进纯逻辑模块）。
 */
function parseLocalDateTime(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?/.exec(value)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2]) - 1
  const day = Number(m[3])
  const d = new Date(year, month, day, Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0))
  // 显式校验：Date 会把 2026-02-30 静默翻滚到 3 月
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null
  return d
}

/** ISO/本地时间 → 本地日期键 `YYYY-MM-DD`；无法解析返回 null */
export function localDateKey(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = parseLocalDateTime(iso)
  if (!d) return null
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** `YYYY-MM-DD` → 年/月（month 0-11）；不合法返回 null */
export function monthOfDateKey(key: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(key)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2]) - 1
  if (month < 0 || month > 11) return null
  return { year, month }
}

/** 按本地日期分组；组内按开始时间升序（一天多场从上到下） */
export function groupRowsByDate<T extends AttendanceRowLike>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const key = localDateKey(row.rehearsals?.start_time ?? null)
    if (!key) continue
    const list = map.get(key) ?? []
    list.push(row)
    map.set(key, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) =>
      (a.rehearsals?.start_time ?? '').localeCompare(b.rehearsals?.start_time ?? '')
    )
  }
  return map
}

const startMs = (row: AttendanceRowLike): number | null => {
  const raw = row.rehearsals?.start_time
  if (!raw) return null
  const d = parseLocalDateTime(raw)
  return d ? d.getTime() : null
}

/**
 * 这一行是否**可编辑**：已过去/当前、且不是 exempt。
 * 未来与 exempt 与「没有排练」同处理（0.6.2 产品定）：不画阴影、不提供修改入口。
 */
export function isEditableAttendanceRow(row: AttendanceRowLike, now: number): boolean {
  const t = startMs(row)
  if (t === null || t > now) return false
  return (row.status ?? 'absent') !== 'exempt'
}

/**
 * 某一天日历格的阴影色：
 *   · 未来 / 无需出勤（exempt）不参与；
 *   · 一天多场取**最严重**的一色：缺席 > 请假 > 迟到 > 出勤（产品 2026-11-10 确认）；
 *   · 一场都不参与 → null（不画阴影，也不可点）。
 */
export function dayTone(rows: AttendanceRowLike[], now: number): StatusTone | null {
  let tone: StatusTone | null = null
  for (const row of rows) {
    if (!isEditableAttendanceRow(row, now)) continue
    const next = ATTENDANCE_TONE[row.status ?? 'absent']
    if (!tone || SEVERITY[next] > SEVERITY[tone]) tone = next
  }
  return tone
}

export type AttendanceStats = {
  /** present + late（迟到已抛弃，存量归入出勤） */
  present: number
  absent: number
  excused: number
  total: number
}

/** 出勤/缺席/请假占比（排除 exempt 与未来；null 状态按缺席） */
export function computeAttendanceStats(rows: AttendanceRowLike[], now: number): AttendanceStats {
  let present = 0
  let absent = 0
  let excused = 0
  for (const row of rows) {
    const t = startMs(row)
    if (t === null || t > now) continue
    const status = row.status ?? 'absent'
    if (status === 'exempt') continue
    if (status === 'present' || status === 'late') present += 1
    else if (status === 'absent') absent += 1
    else if (status === 'excused') excused += 1
  }
  return { present, absent, excused, total: present + absent + excused }
}

/**
 * 月历的格子：返回 7 的倍数个项；`null` = 前后补白。
 * 周首 = 周日（与 `日一二三四五六` 表头一致）。
 */
export function monthGrid(year: number, month: number): Array<string | null> {
  const leading = new Date(year, month, 1).getDay()
  const days = new Date(year, month + 1, 0).getDate()
  const cells: Array<string | null> = []
  for (let i = 0; i < leading; i += 1) cells.push(null)
  for (let d = 1; d <= days; d += 1) {
    cells.push(`${year}-${pad(month + 1)}-${pad(d)}`)
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

/** 月份加减（跨年） */
export function addMonths(
  year: number,
  month: number,
  delta: number
): { year: number; month: number } {
  const d = new Date(year, month + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}
