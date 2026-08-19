import { describe, it, expect } from 'vitest'
import { formatLocalISO } from './date-utils'
import { isRehearsalWithinNextWeek } from './rehearsal-utils'

// 固定"今天"为 2026-08-14 10:30（本地时区），便于边界断言
const NOW = new Date(2026, 7, 14, 10, 30, 0)

/** 构造相对"今天"偏移 dayOffset 天的本地时间 ISO 字符串 */
function isoAt(dayOffset: number, hour = 20, minute = 0, second = 0): string {
  return formatLocalISO(new Date(2026, 7, 14 + dayOffset, hour, minute, second))
}

describe('rehearsal-utils', () => {
  describe('isRehearsalWithinNextWeek', () => {
    it('今天（偏移 0）的排练显示', () => {
      expect(isRehearsalWithinNextWeek(isoAt(0), NOW)).toBe(true)
    })

    it('未来 1-7 天内的排练显示', () => {
      for (let offset = 1; offset <= 7; offset++) {
        expect(isRehearsalWithinNextWeek(isoAt(offset), NOW)).toBe(true)
      }
    })

    it('昨天及更早的排练隐藏', () => {
      expect(isRehearsalWithinNextWeek(isoAt(-1), NOW)).toBe(false)
      expect(isRehearsalWithinNextWeek(isoAt(-30), NOW)).toBe(false)
      expect(isRehearsalWithinNextWeek(isoAt(-365), NOW)).toBe(false)
    })

    it('超过一周（今天+8天及以后）的排练隐藏', () => {
      expect(isRehearsalWithinNextWeek(isoAt(8), NOW)).toBe(false)
      expect(isRehearsalWithinNextWeek(isoAt(30), NOW)).toBe(false)
      expect(isRehearsalWithinNextWeek(isoAt(365), NOW)).toBe(false)
    })

    it('边界：今天 00:00:00 显示', () => {
      expect(isRehearsalWithinNextWeek(isoAt(0, 0, 0, 0), NOW)).toBe(true)
    })

    it('边界：今天+7天 23:59:59 显示', () => {
      expect(isRehearsalWithinNextWeek(isoAt(7, 23, 59, 59), NOW)).toBe(true)
    })

    it('边界：今天+8天 00:00:00 隐藏', () => {
      expect(isRehearsalWithinNextWeek(isoAt(8, 0, 0, 0), NOW)).toBe(false)
    })

    it('边界：昨天 23:59:59 隐藏', () => {
      expect(isRehearsalWithinNextWeek(isoAt(-1, 23, 59, 59), NOW)).toBe(false)
    })

    it('无 start_time（null）保留显示', () => {
      expect(isRehearsalWithinNextWeek(null, NOW)).toBe(true)
    })

    it('空字符串 start_time 保留显示', () => {
      expect(isRehearsalWithinNextWeek('', NOW)).toBe(true)
    })

    it('无法解析的 start_time 保守保留', () => {
      expect(isRehearsalWithinNextWeek('garbage', NOW)).toBe(true)
    })

    it('跨月/跨年时窗口仍正确（7月31日 → 8月7日）', () => {
      const julyNow = new Date(2026, 6, 31, 12, 0, 0)
      // 今天 + 7 天 = 8月7日，仍应显示
      expect(isRehearsalWithinNextWeek('2026-08-07T20:00:00', julyNow)).toBe(true)
      // 8月8日已超过一周，隐藏
      expect(isRehearsalWithinNextWeek('2026-08-08T00:00:00', julyNow)).toBe(false)
      // 7月30日已过去，隐藏
      expect(isRehearsalWithinNextWeek('2026-07-30T23:59:59', julyNow)).toBe(false)
    })

    it('跨年窗口：12月25日 → 次年1月1日 23:59:59 仍在窗口内', () => {
      const decNow = new Date(2026, 11, 25, 12, 0, 0)
      // 今天 + 7 天 = 次年1月1日（12月有31天），23:59:59 仍应显示
      expect(isRehearsalWithinNextWeek('2027-01-01T23:59:59', decNow)).toBe(true)
      // 次年1月2日 00:00:00 已超过一周，隐藏
      expect(isRehearsalWithinNextWeek('2027-01-02T00:00:00', decNow)).toBe(false)
    })

    it('闰年 2 月末：2月25日 → 3月3日 23:59:59 仍在窗口内', () => {
      // 2028 为闰年（2月有29天）
      const febNow = new Date(2028, 1, 25, 12, 0, 0)
      // 今天 + 7 天 = 3月3日，23:59:59 仍应显示
      expect(isRehearsalWithinNextWeek('2028-03-03T23:59:59', febNow)).toBe(true)
      // 3月4日 00:00:00 已超过一周，隐藏
      expect(isRehearsalWithinNextWeek('2028-03-04T00:00:00', febNow)).toBe(false)
    })
  })
})
