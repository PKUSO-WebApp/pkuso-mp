import { describe, it, expect } from 'vitest'
import {
  hasSignedIn,
  canSignIn,
  judgeAttendanceStatus,
  getSignBlockReason,
} from './attendance-utils'

describe('hasSignedIn（签到锁定判定，Issue #141）', () => {
  it('时间戳非空判定为已签到（锁定）', () => {
    expect(hasSignedIn('2026-08-15T20:05:00')).toBe(true)
  })

  it('null 判定为未签到', () => {
    expect(hasSignedIn(null)).toBe(false)
  })

  it('undefined 判定为未签到', () => {
    expect(hasSignedIn(undefined)).toBe(false)
  })

  it('空字符串判定为未签到', () => {
    expect(hasSignedIn('')).toBe(false)
  })
})

describe('canSignIn（签到窗口）', () => {
  const start = new Date('2026-08-15T20:00:00')
  const end = new Date('2026-08-15T22:00:00')

  it('窗口开启前（提前超过 30 分钟）不可签到', () => {
    expect(canSignIn(new Date('2026-08-15T19:20:00'), start, end)).toBe(false)
  })

  it('窗口开启后（提前 30 分钟内）可签到', () => {
    expect(canSignIn(new Date('2026-08-15T19:31:00'), start, end)).toBe(true)
  })

  it('排练结束后不可签到', () => {
    expect(canSignIn(new Date('2026-08-15T22:01:00'), start, end)).toBe(false)
  })
})

describe('judgeAttendanceStatus（出勤状态判定）', () => {
  const start = new Date('2026-08-15T20:00:00')
  const end = new Date('2026-08-15T22:00:00')

  it('宽限期内签到为出席', () => {
    expect(judgeAttendanceStatus(new Date('2026-08-15T20:14:59'), start, end)).toBe('present')
  })

  it('宽限期后至结束前签到仍为出席', () => {
    expect(judgeAttendanceStatus(new Date('2026-08-15T20:15:01'), start, end)).toBe('present')
  })

  it('结束后签到为缺席', () => {
    expect(judgeAttendanceStatus(new Date('2026-08-15T22:00:01'), start, end)).toBe('absent')
  })
})

describe('getSignBlockReason（签到窗口判定，Issue #173）', () => {
  it('start_time 为空 → null（无法判定）', () => {
    expect(getSignBlockReason(null, null, new Date('2026-08-15T21:00:00'))).toBeNull()
  })

  it('无法解析的 start_time → null（卡片显示签到按钮，不误判为已结束）', () => {
    // parseLocalISO 对垃圾字符串退化为 1900 年附近（非 NaN），年份守卫应拦截
    expect(getSignBlockReason('垃圾时间', null, new Date('2026-08-15T21:00:00'))).toBeNull()
    expect(getSignBlockReason('', null, new Date('2026-08-15T21:00:00'))).toBeNull()
  })

  it('无法解析的 end_time → null（视为无法判定，不误判为已结束）', () => {
    expect(
      getSignBlockReason('2026-08-15T20:00:00', '垃圾时间', new Date('2026-08-15T21:00:00'))
    ).toBeNull()
  })

  it('已过结束时间 → ended', () => {
    expect(
      getSignBlockReason(
        '2026-08-15T20:00:00',
        '2026-08-15T22:00:00',
        new Date('2026-08-15T22:01:00')
      )
    ).toBe('ended')
  })

  it('提前超过 30 分钟 → not-started', () => {
    expect(
      getSignBlockReason(
        '2026-08-15T20:00:00',
        '2026-08-15T22:00:00',
        new Date('2026-08-15T19:20:00')
      )
    ).toBe('not-started')
  })

  it('签到窗口内 → null（可签到）', () => {
    expect(
      getSignBlockReason(
        '2026-08-15T20:00:00',
        '2026-08-15T22:00:00',
        new Date('2026-08-15T19:40:00')
      )
    ).toBeNull()
  })

  it('end_time 缺失时按 start + 3 小时计', () => {
    // start 20:00 + 3h = 23:00 结束，now 22:00 仍在窗口内可签到
    expect(
      getSignBlockReason('2026-08-15T20:00:00', null, new Date('2026-08-15T22:00:00'))
    ).toBeNull()
  })
})
