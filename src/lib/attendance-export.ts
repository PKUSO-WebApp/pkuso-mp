import { localDateKey } from '@/lib/attendance-calendar'

/**
 * 团长排练考勤导出的纯逻辑（日期筛选、卡片日期行、文件名）。
 *
 * 表格本身是 xlsx（每场排练一个 sheet），见 `attendance-xlsx.ts`。
 * 本文件不 import Taro / supabase，便于单测。
 */

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

/**
 * 文件名：第一场到最后一场的日期（由调用方从选中的排练算出来）。
 * 没有日期时才退回「全部」。
 */
export function buildWorkbookFileName(opts: {
  prefix: string
  startDate: string
  endDate: string
  allLabel: string
}): string {
  const start = opts.startDate || opts.allLabel
  const end = opts.endDate || opts.allLabel
  return `${opts.prefix}_${sanitizeFilePart(start)}_${sanitizeFilePart(end)}.xlsx`
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
