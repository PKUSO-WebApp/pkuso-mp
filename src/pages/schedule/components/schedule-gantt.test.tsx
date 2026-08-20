// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { getScheduleColorClass, parseTimeToHours } from './schedule-gantt'

vi.mock('@tarojs/components', () => {
  const React = require('react')
  const create = (tag: string) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span') }
})

vi.mock('@/lib/supabase', () => ({
  supabase: {},
}))

describe('schedule-gantt 纯函数', () => {
  it('getScheduleColorClass 按 id 哈希循环分配 7 色', () => {
    expect(getScheduleColorClass(0)).toBe('bg-schedule-1')
    expect(getScheduleColorClass(1)).toBe('bg-schedule-2')
    expect(getScheduleColorClass(6)).toBe('bg-schedule-7')
    expect(getScheduleColorClass(7)).toBe('bg-schedule-1')
    // 负数 id 不越界
    expect(getScheduleColorClass(-3)).toBe('bg-schedule-4')
  })

  it('parseTimeToHours 解析整点与半点', () => {
    expect(parseTimeToHours('2026-01-01T08:00:00')).toBe(8)
    expect(parseTimeToHours('2026-01-01T14:30:00')).toBe(14.5)
  })

  it('parseTimeToHours 空值与无效时间返回 0', () => {
    expect(parseTimeToHours(null)).toBe(0)
    expect(parseTimeToHours('无效时间')).toBe(0)
  })
})
