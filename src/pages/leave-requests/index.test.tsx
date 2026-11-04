// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { resetTestLocale, setTestLocale } from '@/test-utils/i18n-mock'
import LeaveRequestsPage from './index'

const leaveRow = {
  id: 'r1',
  status: 'pending' as const,
  reason: '感冒发烧',
  reject_reason: null,
  created_at: '2026-03-01T10:00:00',
  rehearsals: {
    type: 'full',
    start_time: '2026-03-01T11:00:00',
    end_time: '2026-03-01T13:00:00',
  },
}

const attendanceNotice = {
  id: 'n1',
  user_id: 'u1',
  category: 'attendance' as const,
  title: '考勤状态已更新',
  content: '《德五》排练的考勤状态已更新为「出席」',
  read_at: null,
  created_at: '2026-03-01T10:00:00',
  kind: null,
  meta: null,
}

const { orderMock, fetchByCategoryMock, markCategoryReadMock } = vi.hoisted(() => ({
  orderMock: vi.fn(),
  fetchByCategoryMock: vi.fn(() => Promise.resolve({ rows: [], error: null })),
  markCategoryReadMock: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('@tarojs/components', () => {
  const create = (tag: any) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span'), ScrollView: create('div') }
})
vi.mock('@tarojs/taro', () => ({
  default: { setNavigationBarTitle: vi.fn(), navigateTo: vi.fn() },
  useDidShow: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ order: orderMock }) }) },
}))
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({
    fetchByCategory: fetchByCategoryMock,
    markCategoryRead: markCategoryReadMock,
  }),
}))
vi.mock('@/components/notification-badge-sync', () => ({ notifyNotificationsUpdated: vi.fn() }))
vi.mock('@/context/theme-context', () => ({ useThemeClass: () => '' }))
vi.mock('@/lib/date-utils', () => ({
  formatRehearsalRange: () => '2026-03-01 19:00',
  formatDateTimeInChina: () => '2026-03-01 18:00',
}))
vi.mock('@/components/ui/StatusChip', () => ({
  StatusChip: ({ children }: any) => React.createElement('span', null, children),
}))
vi.mock('@/components/ui/SegmentTabs', () => ({
  SegmentTabs: ({ tabs, onChange }: any) =>
    React.createElement(
      'div',
      null,
      tabs.map((t: any) =>
        React.createElement('button', { key: t.key, onClick: () => onChange(t.key) }, t.label)
      )
    ),
}))

// t 必须是稳定引用：本页 effect 的依赖里有 t（与真机一致，useT 内是 useCallback），
// 每次渲染换一个新 t 会让 effect 反复重跑，新请求不断作废旧请求 → 永远停在 loading
vi.mock('@/i18n', async () => {
  const { createI18nMock } = await import('@/test-utils/i18n-mock')
  return createI18nMock()
})

describe('请假记录页失败态', () => {
  beforeEach(() => {
    resetTestLocale()
    orderMock.mockReset()
    fetchByCategoryMock.mockReset()
    fetchByCategoryMock.mockResolvedValue({ rows: [], error: null })
    markCategoryReadMock.mockReset()
    markCategoryReadMock.mockResolvedValue(true)
  })
  afterEach(() => {
    cleanup()
  })

  it('英文环境：失败态给出英文文案与重试入口', async () => {
    setTestLocale('en')
    orderMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    render(<LeaveRequestsPage />)
    expect(await screen.findByText('Failed to load, please retry')).toBeTruthy()
    expect(screen.getByText('Retry')).toBeTruthy()
  })

  it('加载失败时给重试入口；重试真的重新查询并恢复内容', async () => {
    orderMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    render(<LeaveRequestsPage />)
    expect(await screen.findByText('加载失败，请稍后重试')).toBeTruthy()
    const callsAfterFirstLoad = orderMock.mock.calls.length

    orderMock.mockResolvedValue({ data: [leaveRow], error: null })
    fireEvent.click(screen.getByText('重试'))

    expect(await screen.findByText('感冒发烧')).toBeTruthy()
    // 断言「又发了一次请求」，而不只是「按钮被点过」
    expect(orderMock.mock.calls.length).toBe(callsAfterFirstLoad + 1)
    expect(screen.queryByText('加载失败，请稍后重试')).toBeNull()
    expect(screen.queryByText('重试')).toBeNull()
  })

  it('加载成功时不出现重试入口', async () => {
    orderMock.mockResolvedValue({ data: [leaveRow], error: null })
    render(<LeaveRequestsPage />)
    expect(await screen.findByText('感冒发烧')).toBeTruthy()
    expect(screen.queryByText('重试')).toBeNull()
  })

  it('考勤通知要显示内容再标已读——不能只清红点', async () => {
    orderMock.mockResolvedValue({ data: [], error: null })
    fetchByCategoryMock.mockResolvedValue({ rows: [attendanceNotice], error: null } as never)
    render(<LeaveRequestsPage />)

    expect(await screen.findByText('考勤状态已更新')).toBeTruthy()
    expect(screen.getByText('《德五》排练的考勤状态已更新为「出席」')).toBeTruthy()
    await waitFor(() =>
      expect(markCategoryReadMock).toHaveBeenCalledWith('attendance', ['n1'])
    )
  })
})
