import { translateCurrent, getLocale } from '@/i18n/core'

/**
 * 将 Date 对象格式化为本地时间的 ISO 字符串（不含时区偏移）
 * 避免 toISOString() 将本地时间转为 UTC 时间导致的时区偏移问题
 *
 * @param date - Date 对象
 * @returns 格式为 "YYYY-MM-DDTHH:mm:ss" 的字符串
 */
export function formatLocalISO(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('Invalid Date object')
  }
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`
}

/**
 * 获取本地日期字符串（YYYY-MM-DD），避免时区转换问题
 *
 * @param date - Date 对象，默认为当前日期
 * @returns 格式为 "YYYY-MM-DD" 的字符串
 */
export function getLocalDateString(date: Date = new Date()): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('Invalid Date object')
  }
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Intl 是否可用（微信旧版 JSCore / 低端安卓可能缺失，需要手写降级格式化） */
function hasIntl(): boolean {
  return typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function'
}

/** 手写补零格式化 "MM/DD HH:mm"（Intl 缺失时的降级路径，与 zh-CN 输出格式一致） */
function formatDateTimeManual(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${month}/${day} ${hours}:${minutes}`
}

/** 手写补零格式化 "HH:mm"（Intl 缺失时的降级路径） */
function formatTimeManual(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/** 将 UTC Date 转换为中国时区（UTC+8）后手写格式化 "MM/DD HH:mm"（Intl 缺失降级用） */
function formatChinaTimeManual(date: Date): string {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  const hours = String(shifted.getUTCHours()).padStart(2, '0')
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0')
  return `${month}/${day} ${hours}:${minutes}`
}

/** 月份 code（对齐 i18n schedule.monthAbbr），供本地化月份缩写 */
const MONTH_CODES = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
]
/** 星期 code（对齐 i18n schedule.weekdayShort），0=周日 */
const DOW_CODES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/**
 * 将 ISO 字符串解析为本地时间的 Date 对象
 * 直接使用字符串中的年月日时分秒，不进行时区转换
 *
 * @param dateStr - ISO 格式字符串（如 "YYYY-MM-DDTHH:mm:ss"）
 * @returns Date 对象（本地时间）
 */
export function parseLocalISO(dateStr: string): Date {
  const parts = dateStr.split('T')
  const dateParts = parts[0]?.split('-') ?? []
  const timeParts = parts[1]?.split(':') ?? []

  const year = parseInt(dateParts[0], 10) || 0
  const month = (parseInt(dateParts[1], 10) || 1) - 1
  const day = parseInt(dateParts[2], 10) || 1
  const hours = parseInt(timeParts[0], 10) || 0
  const minutes = parseInt(timeParts[1], 10) || 0
  const seconds = parseInt(timeParts[2], 10) || 0

  // 非法日期校验：JS 的 Date 构造函数会把 2026-02-30 这类日期静默翻滚到 3 月，
  // 这里显式校验月 ∈ [1,12] 且 day 不超过当月天数，非法输入返回 Invalid Date（NaN）
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  if (month < 0 || month > 11 || day < 1 || day > daysInMonth) {
    return new Date(NaN)
  }

  return new Date(year, month, day, hours, minutes, seconds)
}

/**
 * 格式化时间为 HH:mm 格式
 * 使用 parseLocalISO 解析，避免时区问题
 *
 * @param timeStr - ISO 格式字符串（如 "YYYY-MM-DDTHH:mm:ss"）或 null
 * @returns 格式为 "HH:mm" 的字符串，无效时返回 "--:--"
 */
export function formatTime(timeStr: string | null): string {
  if (!timeStr) return '--:--'
  if (/T24:00(:00)?$/.test(timeStr)) return '23:59'
  const date = parseLocalISO(timeStr)
  if (Number.isNaN(date.getTime())) return '--:--'
  return date.toTimeString().slice(0, 5)
}

/**
 * 格式化日期为 "月日 星期几" 格式
 * 使用 parseLocalISO 解析，避免时区问题
 *
 * @param dateStr - ISO 格式字符串（如 "YYYY-MM-DD" 或 "YYYY-MM-DDTHH:mm:ss"）
 * @returns 格式为 "X月X日 星期X" 的字符串
 */
export function formatDisplayDate(dateStr: string): string {
  const date = parseLocalISO(dateStr)
  // 非法日期守卫：避免把 NaN/翻滚日期渲染成 1900 年 1 月 1 日
  if (Number.isNaN(date.getTime())) return '—'
  const month = translateCurrent(`schedule.monthAbbr.${MONTH_CODES[date.getMonth()]}`)
  const day = String(date.getDate())
  const weekday = translateCurrent(`schedule.weekdayShort.${DOW_CODES[date.getDay()]}`)
  const tpl = translateCurrent('schedule.dateFormat')
  return tpl.replace('{month}', month).replace('{day}', day).replace('{weekday}', weekday)
}

/**
 * 格式化日期时间为 "MM-DD HH:mm" 格式
 * 使用 parseLocalISO 解析，避免时区问题
 *
 * @param dateStr - ISO 格式字符串（如 "YYYY-MM-DDTHH:mm:ss"）或 null
 * @returns 格式为 "MM-DD HH:mm" 的字符串，无效时返回 "—"
 */
export function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '—'
  const date = parseLocalISO(dateStr)
  if (Number.isNaN(date.getTime())) return dateStr
  // Intl 缺失降级为手写补零格式化（微信旧版 JSCore / 低端安卓）
  if (!hasIntl()) return formatDateTimeManual(date)
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

/**
 * 格式化排练时间段为 "X月X日 星期X HH:mm - HH:mm" 格式
 * 供 member/admin 两端共用（原位于 member 端私有 utils，迁移至此消除跨端 import）
 *
 * @param startValue - 开始时间 ISO 字符串（如 "YYYY-MM-DDTHH:mm:ss"）
 * @param endValue - 结束时间 ISO 字符串或 null
 * @returns 格式化后的时间段文案；结束时间为空时仅返回开始时间
 */
export function formatRehearsalRange(startValue: string, endValue: string | null) {
  const start = parseLocalISO(startValue)
  if (Number.isNaN(start.getTime())) return startValue
  const end = endValue ? parseLocalISO(endValue) : null

  // 时间格式化：Intl 缺失时降级为手写补零，避免 old JSCore 直接抛错
  const hasIntlSupport = hasIntl()
  const timeFormatter = hasIntlSupport
    ? new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : null

  const month = translateCurrent(`schedule.monthAbbr.${MONTH_CODES[start.getMonth()]}`)
  const day = String(start.getDate())
  const weekday = translateCurrent(`schedule.weekdayShort.${DOW_CODES[start.getDay()]}`)
  const tpl = translateCurrent('schedule.dateFormat')
  const datePart = tpl.replace('{month}', month).replace('{day}', day).replace('{weekday}', weekday)
  const dateTimeSep = translateCurrent('schedule.dateTimeSep')
  const timeRangeSep = translateCurrent('schedule.timeRangeSep')

  const startTime = timeFormatter ? timeFormatter.format(start) : formatTimeManual(start)

  if (!end || Number.isNaN(end.getTime())) return `${datePart}${dateTimeSep}${startTime}`
  const endTimeFormatted = timeFormatter ? timeFormatter.format(end) : formatTimeManual(end)
  return `${datePart}${dateTimeSep}${startTime}${timeRangeSep}${endTimeFormatted}`
}

export type RehearsalCardParts = {
  dateLabel: string
  weekdayLabel: string
  timeRange: string
}

/**
 * 将排练起止时间拆为卡片所需的日期行与时间行
 * - dateLabel: "8月30日"（不含星期）
 * - weekdayLabel: "周六"
 * - timeRange: "14:00 - 17:00"
 */
export function formatRehearsalCardParts(
  startValue: string,
  endValue: string | null
): RehearsalCardParts {
  const start = parseLocalISO(startValue)
  if (Number.isNaN(start.getTime()))
    return { dateLabel: startValue, weekdayLabel: '', timeRange: '' }
  const end = endValue ? parseLocalISO(endValue) : null

  const month = translateCurrent(`schedule.monthAbbr.${MONTH_CODES[start.getMonth()]}`)
  const day = String(start.getDate())
  const dateLabel = `${month}${day}日`
  const weekdayLabel = translateCurrent(`schedule.weekdayShort.${DOW_CODES[start.getDay()]}`)

  const hasIntlSupport = hasIntl()
  const timeFormatter = hasIntlSupport
    ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    : null
  const startTime = timeFormatter ? timeFormatter.format(start) : formatTimeManual(start)
  if (!end || Number.isNaN(end.getTime())) return { dateLabel, weekdayLabel, timeRange: startTime }
  const endTime = timeFormatter ? timeFormatter.format(end) : formatTimeManual(end)
  const sep = translateCurrent('schedule.timeRangeSep')
  return { dateLabel, weekdayLabel, timeRange: `${startTime}${sep}${endTime}` }
}

/**
 * 判断排练是否已过期（结束时间（或开始时间）+ 12 小时后仍早于当前时间）
 * 供 member/admin 两端共用（原位于 member 端私有 utils，迁移至此消除跨端 import）
 *
 * @param startTime - 开始时间 ISO 字符串
 * @param endTime - 结束时间 ISO 字符串或 null
 * @returns 是否已过期；时间解析失败时返回 false
 */
export function isRehearsalExpired(startTime: string, endTime: string | null) {
  const base = endTime ? parseLocalISO(endTime) : parseLocalISO(startTime)
  if (Number.isNaN(base.getTime())) return false
  return Date.now() > base.getTime() + 12 * 60 * 60 * 1000
}

/**
 * 将 UTC 时间字符串转换为中国时区显示
 * 检测以下 UTC 格式：
 * - 以 Z 结尾：如 "2024-07-31T14:30:00Z"
 * - 以 +00 结尾：如 "2026-07-31 08:19:11.1906+00"
 * - 带时区偏移：如 "2024-07-31T14:30:00+00:00"
 * 如果没有时区后缀，则直接按本地时间解析显示
 *
 * @param dateStr - ISO 格式字符串或 null
 * @returns 格式为 "MM/DD HH:mm" 的字符串，无效时返回 "—"
 */
export function formatDateTimeInChina(dateStr: string | null): string {
  if (!dateStr) return '—'

  if (getLocale() === 'en') return formatEnDateTime(dateStr)

  // 检测是否为 UTC 时间（Z 后缀 或 +00:00 偏移）
  const isUTC =
    dateStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr) || /\+00(?::\d{2})?$/.test(dateStr)

  if (isUTC) {
    // UTC 时间，转换为中国时区
    const date = new Date(dateStr)
    if (Number.isNaN(date.getTime())) return '—'
    // Intl 缺失降级为手写 UTC+8 换算格式化
    if (!hasIntl()) return formatChinaTimeManual(date)
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Shanghai',
    }).format(date)
  } else {
    // 本地时间（无时区后缀），直接解析
    const date = parseLocalISO(dateStr)
    if (Number.isNaN(date.getTime())) return '—'
    // Intl 缺失降级为手写补零格式化
    if (!hasIntl()) return formatDateTimeManual(date)
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date)
  }
}

/** 英文通知/公告时间戳：与 zh 同一上海墙钟，输出 "Wed, Aug 25, 14:30"（无年份、24h） */
function formatEnDateTime(dateStr: string): string {
  const isUTC =
    dateStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr) || /\+00(?::\d{2})?$/.test(dateStr)
  if (isUTC) {
    const d = new Date(dateStr)
    if (Number.isNaN(d.getTime())) return '—'
    // 与 zh 的 timeZone: 'Asia/Shanghai' 对齐：+8h 后取 UTC 字段即上海墙钟
    const shanghai = new Date(d.getTime() + 8 * 60 * 60 * 1000)
    const month = MONTH_CODES[shanghai.getUTCMonth()]
    const day = String(shanghai.getUTCDate())
    const weekday = DOW_CODES[shanghai.getUTCDay()]
    const time = `${String(shanghai.getUTCHours()).padStart(2, '0')}:${String(shanghai.getUTCMinutes()).padStart(2, '0')}`
    return buildEnDatePart(month, day, weekday) + translateCurrent('schedule.dateTimeSep') + time
  }
  const d = parseLocalISO(dateStr)
  if (Number.isNaN(d.getTime())) return '—'
  const month = MONTH_CODES[d.getMonth()]
  const day = String(d.getDate())
  const weekday = DOW_CODES[d.getDay()]
  return (
    buildEnDatePart(month, day, weekday) +
    translateCurrent('schedule.dateTimeSep') +
    formatTimeManual(d)
  )
}

/** 英文日期部分：按 {weekday}, {month} {day} 模板填充 */
function buildEnDatePart(monthCode: string, day: string, weekdayCode: string): string {
  const month = translateCurrent(`schedule.monthAbbr.${monthCode}`)
  const weekday = translateCurrent(`schedule.weekdayShort.${weekdayCode}`)
  const tpl = translateCurrent('schedule.dateFormat')
  return tpl.replace('{month}', month).replace('{day}', day).replace('{weekday}', weekday)
}
