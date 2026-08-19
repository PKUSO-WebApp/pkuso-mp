import { describe, it, expect, vi } from 'vitest'
import {
  formatLocalISO,
  parseLocalISO,
  getLocalDateString,
  formatTime,
  formatDisplayDate,
  formatDateTime,
  formatDateTimeInChina,
} from './date-utils'

describe('date-utils', () => {
  describe('formatLocalISO', () => {
    it('应该正确格式化正常日期时间', () => {
      const date = new Date(2024, 5, 15, 14, 30, 45)
      expect(formatLocalISO(date)).toBe('2024-06-15T14:30:45')
    })

    it('应该正确处理凌晨时间（00:30）', () => {
      const date = new Date(2024, 0, 1, 0, 30, 0)
      expect(formatLocalISO(date)).toBe('2024-01-01T00:30:00')
    })

    it('应该正确处理闰年2月29日', () => {
      const date = new Date(2024, 1, 29, 12, 0, 0)
      expect(formatLocalISO(date)).toBe('2024-02-29T12:00:00')
    })

    it('应该正确处理跨年时间（12月31日）', () => {
      const date = new Date(2024, 11, 31, 23, 59, 59)
      expect(formatLocalISO(date)).toBe('2024-12-31T23:59:59')
    })

    it('应该正确处理新年第一天（1月1日）', () => {
      const date = new Date(2025, 0, 1, 0, 0, 0)
      expect(formatLocalISO(date)).toBe('2025-01-01T00:00:00')
    })

    it('应该正确处理个位数月份和日期的补零', () => {
      const date = new Date(2024, 0, 5, 9, 5, 3)
      expect(formatLocalISO(date)).toBe('2024-01-05T09:05:03')
    })

    it('应该对无效Date对象抛出错误', () => {
      expect(() => formatLocalISO(new Date('invalid'))).toThrow('Invalid Date object')
      expect(() => formatLocalISO({} as Date)).toThrow('Invalid Date object')
    })
  })

  describe('parseLocalISO', () => {
    it('应该正确解析正常ISO字符串', () => {
      const date = parseLocalISO('2024-06-15T14:30:45')
      expect(date.getFullYear()).toBe(2024)
      expect(date.getMonth()).toBe(5) // 0-indexed
      expect(date.getDate()).toBe(15)
      expect(date.getHours()).toBe(14)
      expect(date.getMinutes()).toBe(30)
      expect(date.getSeconds()).toBe(45)
    })

    it('应该正确解析凌晨时间', () => {
      const date = parseLocalISO('2024-01-01T00:30:00')
      expect(date.getHours()).toBe(0)
      expect(date.getMinutes()).toBe(30)
    })

    it('应该正确解析闰年2月29日', () => {
      const date = parseLocalISO('2024-02-29T12:00:00')
      expect(date.getFullYear()).toBe(2024)
      expect(date.getMonth()).toBe(1)
      expect(date.getDate()).toBe(29)
    })

    it('应该正确解析跨年时间', () => {
      const date = parseLocalISO('2024-12-31T23:59:59')
      expect(date.getFullYear()).toBe(2024)
      expect(date.getMonth()).toBe(11)
      expect(date.getDate()).toBe(31)
    })

    it('应该正确处理缺少秒数的ISO字符串', () => {
      const date = parseLocalISO('2024-06-15T14:30')
      expect(date.getHours()).toBe(14)
      expect(date.getMinutes()).toBe(30)
      expect(date.getSeconds()).toBe(0)
    })

    it('应该正确处理缺少时间部分的ISO字符串', () => {
      const date = parseLocalISO('2024-06-15')
      expect(date.getFullYear()).toBe(2024)
      expect(date.getMonth()).toBe(5)
      expect(date.getDate()).toBe(15)
      expect(date.getHours()).toBe(0)
      expect(date.getMinutes()).toBe(0)
    })

    it('应该处理无效输入返回有效Date对象（默认值）', () => {
      const date = parseLocalISO('invalid')
      expect(date instanceof Date).toBe(true)
    })

    it('非法日期 2026-02-30 应返回 Invalid Date（不翻滚到 3 月）', () => {
      expect(Number.isNaN(parseLocalISO('2026-02-30').getTime())).toBe(true)
    })

    it('非法月份 2026-13-01 应返回 Invalid Date', () => {
      expect(Number.isNaN(parseLocalISO('2026-13-01').getTime())).toBe(true)
    })

    it('非法日期 day=32 应返回 Invalid Date', () => {
      expect(Number.isNaN(parseLocalISO('2026-01-32').getTime())).toBe(true)
    })
  })

  describe('getLocalDateString', () => {
    it('应该正确获取本地日期字符串', () => {
      const date = new Date(2024, 5, 15)
      expect(getLocalDateString(date)).toBe('2024-06-15')
    })

    it('应该默认使用当前日期', () => {
      // mock 时钟消除对运行时刻的依赖，避免午夜边界 flake
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2024, 5, 15, 12, 0, 0))
      try {
        expect(getLocalDateString()).toBe('2024-06-15')
      } finally {
        vi.useRealTimers()
      }
    })

    it('应该正确处理个位数月份和日期的补零', () => {
      const date = new Date(2024, 0, 5)
      expect(getLocalDateString(date)).toBe('2024-01-05')
    })

    it('应该正确处理跨年日期', () => {
      const date = new Date(2024, 11, 31)
      expect(getLocalDateString(date)).toBe('2024-12-31')
    })

    it('应该对无效Date对象抛出错误', () => {
      expect(() => getLocalDateString(new Date('invalid'))).toThrow('Invalid Date object')
      expect(() => getLocalDateString({} as Date)).toThrow('Invalid Date object')
    })
  })

  describe('formatTime', () => {
    it('应该正确格式化正常时间', () => {
      expect(formatTime('2024-06-15T14:30:45')).toBe('14:30')
    })

    it('应该正确格式化凌晨时间', () => {
      expect(formatTime('2024-01-01T00:30:00')).toBe('00:30')
    })

    it('应该正确格式化午夜时间', () => {
      expect(formatTime('2024-01-01T00:00:00')).toBe('00:00')
    })

    it('应该正确格式化24点前的时间', () => {
      expect(formatTime('2024-12-31T23:59:59')).toBe('23:59')
    })

    it('应该正确处理缺少秒数的时间字符串', () => {
      expect(formatTime('2024-06-15T14:30')).toBe('14:30')
    })

    it('应该对null输入返回--:--', () => {
      expect(formatTime(null)).toBe('--:--')
    })

    it('应该对空字符串返回--:--', () => {
      expect(formatTime('')).toBe('--:--')
    })

    it('应该对无效输入返回默认时间', () => {
      // parseLocalISO 对无效输入返回默认 Date（1970-01-01 00:00:00）
      expect(formatTime('invalid')).toBe('00:00')
    })
  })

  describe('formatDisplayDate', () => {
    it('应该正确格式化正常日期（包含时间部分）', () => {
      // 2024-06-15 是周六
      expect(formatDisplayDate('2024-06-15T14:30:45')).toBe('6月15日 周六')
    })

    it('应该正确格式化纯日期字符串', () => {
      // 2024-01-01 是周一
      expect(formatDisplayDate('2024-01-01')).toBe('1月1日 周一')
    })

    it('应该正确格式化周日', () => {
      // 2024-01-07 是周日
      expect(formatDisplayDate('2024-01-07')).toBe('1月7日 周日')
    })

    it('应该正确格式化闰年2月29日', () => {
      // 2024-02-29 是周四
      expect(formatDisplayDate('2024-02-29')).toBe('2月29日 周四')
    })

    it('应该正确格式化跨年日期', () => {
      // 2024-12-31 是周二
      expect(formatDisplayDate('2024-12-31')).toBe('12月31日 周二')
    })

    it('应该正确格式化新年第一天', () => {
      // 2025-01-01 是周三
      expect(formatDisplayDate('2025-01-01')).toBe('1月1日 周三')
    })

    it('应该正确处理个位数月份和日期', () => {
      // 2024-03-05 是周二
      expect(formatDisplayDate('2024-03-05')).toBe('3月5日 周二')
    })

    it('非法日期应返回占位符—（不渲染成 1900 年 1 月 1 日）', () => {
      expect(formatDisplayDate('2026-02-30')).toBe('—')
      expect(formatDisplayDate('2026-13-01')).toBe('—')
      expect(formatDisplayDate('2026-01-32')).toBe('—')
    })
  })

  describe('formatDateTime', () => {
    it('应该正确格式化正常日期时间', () => {
      // Intl.DateTimeFormat 使用本地日期分隔符，中文环境为 "/"
      expect(formatDateTime('2024-06-15T14:30:45')).toBe('06/15 14:30')
    })

    it('应该正确格式化凌晨时间', () => {
      expect(formatDateTime('2024-01-01T00:30:00')).toBe('01/01 00:30')
    })

    it('应该正确格式化午夜时间', () => {
      expect(formatDateTime('2024-01-01T00:00:00')).toBe('01/01 00:00')
    })

    it('应该正确格式化24点前的时间', () => {
      expect(formatDateTime('2024-12-31T23:59:59')).toBe('12/31 23:59')
    })

    it('应该正确处理缺少秒数的时间字符串', () => {
      expect(formatDateTime('2024-06-15T14:30')).toBe('06/15 14:30')
    })

    it('应该对null输入返回—', () => {
      expect(formatDateTime(null)).toBe('—')
    })

    it('应该对空字符串返回—', () => {
      // !"" 为 true，所以返回 "—"
      expect(formatDateTime('')).toBe('—')
    })

    it('应该对无效输入返回默认日期时间', () => {
      // parseLocalISO 对无效输入返回默认 Date（1970-01-01 00:00:00）
      expect(formatDateTime('invalid')).toBe('01/01 00:00')
    })

    it('应该正确处理个位数月份和日期', () => {
      expect(formatDateTime('2024-03-05T09:05:03')).toBe('03/05 09:05')
    })
  })

  describe('formatDateTimeInChina', () => {
    it('应该对null输入返回—', () => {
      expect(formatDateTimeInChina(null)).toBe('—')
    })

    it('应该对空字符串返回—', () => {
      expect(formatDateTimeInChina('')).toBe('—')
    })

    it('应该对无效Z后缀字符串返回—', () => {
      // new Date("not-a-date-Z") 会产生 Invalid Date
      expect(formatDateTimeInChina('not-a-date-Z')).toBe('—')
    })

    it('应该对无效本地时间字符串不抛异常', () => {
      // parseLocalISO 对无效输入返回默认 Date（1970-01-01 本地时间），
      // 因此不会命中 isNaN 分支，而是正常格式化
      const result = formatDateTimeInChina('garbage')
      expect(result).toBeTruthy()
      expect(result).not.toBe('—')
    })

    it('应该将UTC时间转换为中国时区（Z后缀路径）', () => {
      // 2024-07-31T14:30:00Z = UTC 14:30，北京时间 22:30（同一天）
      const result = formatDateTimeInChina('2024-07-31T14:30:00Z')
      expect(result).toMatch(/07\/31 22:30|7\/31 22:30/)
    })

    it('应该正确处理跨日边界（UTC 23:30 → 中国次日 07:30）', () => {
      // 2024-07-31T23:30:00Z = UTC 23:30，北京时间次日 07:30
      const result = formatDateTimeInChina('2024-07-31T23:30:00Z')
      expect(result).toMatch(/08\/01 07:30|8\/1 07:30/)
    })

    it('应该正确处理本地时间（无时区后缀）', () => {
      // 本地时间 2024-06-15T14:30:45，直接按本地时间显示
      const result = formatDateTimeInChina('2024-06-15T14:30:45')
      expect(result).toMatch(/06\/15 14:30|6\/15 14:30/)
    })

    it('应该正确处理 +00 后缀的 UTC 时间（Issue #90 回归）', () => {
      // Supabase 返回的 timestamptz 格式：2026-07-31 08:19:11.1906+00
      // UTC 08:19 → 北京时间 16:19（同一天）
      const result = formatDateTimeInChina('2026-07-31 08:19:11.1906+00')
      expect(result).toMatch(/07\/31 16:19|7\/31 16:19/)
    })

    it('应该正确处理 +00:00 时区偏移格式', () => {
      // 另一种 UTC 格式：带完整时区偏移
      // UTC 14:30 → 北京时间 22:30
      const result = formatDateTimeInChina('2024-07-31T14:30:00+00:00')
      expect(result).toMatch(/07\/31 22:30|7\/31 22:30/)
    })

    it('应该正确处理 +00 后缀的跨日边界（UTC 时间）', () => {
      // UTC 20:00 → 北京时间次日 04:00
      const result = formatDateTimeInChina('2024-07-31 20:00:00+00')
      expect(result).toMatch(/08\/01 04:00|8\/1 04:00/)
    })
  })
})
