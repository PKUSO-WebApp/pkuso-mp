// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import AttendancePage from './index'

const row = {
  id: 1,
  status: 'present' as const,
  sign_in_time: '2026-03-01T11:00:00',
  rehearsals: {
    id: 7,
    start_time: '2026-03-01T11:00:00',
    end_time: '2026-03-01T13:00:00',
    location: '排练厅',
    repertoire: '德五',
  },
}

const { fetchMyHistoryMock } = vi.hoisted(() => ({ fetchMyHistoryMock: vi.fn() }))

vi.mock('@tarojs/components', () => {
  const create = (tag: any) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return {
    View: create('div'),
    Text: create('span'),
    ScrollView: create('div'),
    // 起/止两个 Picker 各带自己的 value，点一下 = 选中一个日期。
    // 用它驱动「重试是否带上了当前区间」——把 date 参数写死成 '' 的实现会在这里露馅
    Picker: ({ value, onChange, children }: any) =>
      React.createElement(
        'div',
        {
          'data-picker-value': value,
          onClick: () => onChange({ detail: { value: '2026-03-01' } }),
        },
        children
      ),
  }
})
vi.mock('@tarojs/taro', () => ({ default: { navigateTo: vi.fn() } }))
vi.mock('@/hooks/useAttendance', () => ({
  useAttendance: () => ({ fetchMyHistory: fetchMyHistoryMock }),
}))
vi.mock('@/context/theme-context', () => ({ useThemeClass: () => '' }))
vi.mock('@/context/user-context', () => ({ useUser: () => ({ user: { id: 'u1' } }) }))
vi.mock('@/lib/date-utils', () => ({ formatRehearsalRange: () => '2026-03-01 19:00' }))
vi.mock('@/lib/attendance-summary', () => ({
  summarizeAttendance: () => ({ total: 0, present: 0, excused: 0, absent: 0, exempt: 0 }),
}))

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

describe('考勤页失败态', () => {
  beforeEach(() => {
    fetchMyHistoryMock.mockReset()
  })
  afterEach(() => {
    cleanup()
  })

  it('查询失败时给重试入口；重试带着当前日期区间再查一次，成功后撤掉失败态', async () => {
    fetchMyHistoryMock.mockResolvedValue({ rows: [], error: 'loadFailed' })
    render(<AttendancePage />)
    expect(await screen.findByText('加载失败，请稍后重试')).toBeTruthy()

    // 选起始日期。这一步本身也会失败（mock 一直返回 error），失败态应当还在
    const pickers = document.querySelectorAll('[data-picker-value]')
    expect(pickers.length).toBe(2)
    fireEvent.click(pickers[0])
    await waitFor(() =>
      expect(fetchMyHistoryMock).toHaveBeenLastCalledWith('u1', {
        startDate: '2026-03-01',
        endDate: '',
      })
    )
    expect(screen.getByText('重试')).toBeTruthy()

    fetchMyHistoryMock.mockResolvedValue({ rows: [row], error: null })
    fireEvent.click(screen.getByText('重试'))

    expect(await screen.findByText('2026-03-01 19:00')).toBeTruthy()
    // 这条是这个用例的重点：重试必须是**带着刚选的区间**重发，而不是回到「不限日期」
    expect(fetchMyHistoryMock).toHaveBeenLastCalledWith('u1', {
      startDate: '2026-03-01',
      endDate: '',
    })
    expect(screen.queryByText('加载失败，请稍后重试')).toBeNull()
    expect(screen.queryByText('重试')).toBeNull()
  })

  it('查询成功时不出现重试入口', async () => {
    fetchMyHistoryMock.mockResolvedValue({ rows: [row], error: null })
    render(<AttendancePage />)
    expect(await screen.findByText('2026-03-01 19:00')).toBeTruthy()
    expect(screen.queryByText('重试')).toBeNull()
  })
})
