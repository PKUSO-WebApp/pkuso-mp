// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { getScheduleColorClass, parseTimeToHours, ScheduleGantt } from './schedule-gantt'

const { taroMock } = vi.hoisted(() => ({
  taroMock: { showModal: vi.fn(() => Promise.resolve({ confirm: true })) },
}))

vi.mock('@tarojs/components', () => {
  const create = (tag: string) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span') }
})

vi.mock('@tarojs/taro', () => ({ default: taroMock }))

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, children }: any) => (open ? React.createElement('div', null, children) : null),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { full_name: '张三' }, error: null }),
        }),
      }),
    }),
  },
}))

afterEach(() => {
  cleanup()
})

const makeSchedule = (overrides: any = {}) => ({
  id: 1,
  title: '我的预约',
  start_time: '2026-01-01T10:00:00',
  end_time: '2026-01-01T11:00:00',
  author_id: 'u1',
  ...overrides,
})

vi.mock('@/i18n', async () => {
  const mod = await import('@/i18n/messages/zh-CN')
  const dict = mod.zhCN as Record<string, unknown>
  const get = (k: string, p?: Record<string, unknown>): string => {
    const val = k
      .split('.')
      .reduce<unknown>(
        (o, key) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[key] : undefined),
        dict
      )
    let s = typeof val === 'string' ? val : k
    if (p)
      s = s.replace(/\{(\w+)\}/g, (_, key) => (p[key] !== undefined ? String(p[key]) : `{${key}}`))
    return s
  }
  return {
    useT: () => ({
      t: (k: string, p?: Record<string, unknown>) => get(k, p),
      locale: 'zh-CN',
      setLocale: vi.fn(),
    }),
    useNavTitle: vi.fn(),
  }
})
describe('schedule-gantt 纯函数', () => {
  it('getScheduleColorClass 按 id 哈希循环分配 7 色', () => {
    expect(getScheduleColorClass(0)).toBe('bg-schedule-1')
    expect(getScheduleColorClass(1)).toBe('bg-schedule-2')
    expect(getScheduleColorClass(6)).toBe('bg-schedule-7')
    expect(getScheduleColorClass(7)).toBe('bg-schedule-1')
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

describe('ScheduleGantt 删除预约', () => {
  it('创建者可删除：点击预约块 → 显示「删除预约」→ 确认后调用 remove', async () => {
    const remove = vi.fn(async () => true)
    render(
      <ScheduleGantt
        schedules={[makeSchedule()]}
        selectedDate='2026-01-01'
        user={{ id: 'u1' }}
        remove={remove}
      />
    )
    fireEvent.click(screen.getByText('我的预约'))
    expect(screen.getByText('删除预约')).toBeTruthy()
    fireEvent.click(screen.getByText('删除预约'))
    await waitFor(() => expect(taroMock.showModal).toHaveBeenCalled())
    await waitFor(() => expect(remove).toHaveBeenCalledWith(1, '2026-01-01'))
    expect(screen.queryByText('删除预约')).toBeNull()
  })

  it('非创建者不显示「删除预约」', () => {
    const remove = vi.fn(async () => true)
    render(
      <ScheduleGantt
        schedules={[makeSchedule({ author_id: 'u2' })]}
        selectedDate='2026-01-01'
        user={{ id: 'u1' }}
        remove={remove}
      />
    )
    fireEvent.click(screen.getByText('我的预约'))
    expect(screen.queryByText('删除预约')).toBeNull()
  })

  it('确认弹窗取消时不调用 remove', async () => {
    taroMock.showModal.mockResolvedValueOnce({ confirm: false })
    const remove = vi.fn(async () => true)
    render(
      <ScheduleGantt
        schedules={[makeSchedule()]}
        selectedDate='2026-01-01'
        user={{ id: 'u1' }}
        remove={remove}
      />
    )
    fireEvent.click(screen.getByText('我的预约'))
    fireEvent.click(screen.getByText('删除预约'))
    await waitFor(() => expect(taroMock.showModal).toHaveBeenCalled())
    expect(remove).not.toHaveBeenCalled()
  })
})
