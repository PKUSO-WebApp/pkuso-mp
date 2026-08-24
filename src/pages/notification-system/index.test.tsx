// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import NotificationSystemPage from './index'

const rows = [
  {
    id: '1',
    category: 'system' as const,
    title: '维护通知',
    content: '系统将于今晚维护',
    created_at: '2026-01-01T10:00:00',
    read_at: null,
  },
  {
    id: '2',
    category: 'system' as const,
    title: '已读通知',
    content: '已读内容',
    created_at: '2026-01-02T10:00:00',
    read_at: '2026-01-02T10:00:00',
  },
]

const { taroMock, fetchMock, markMock, notifyMock } = vi.hoisted(() => ({
  taroMock: { showToast: vi.fn() },
  fetchMock: vi.fn(() => Promise.resolve({ rows: [] as any[], error: null })),
  markMock: vi.fn(() => Promise.resolve(true)),
  notifyMock: vi.fn(),
}))

vi.mock('@tarojs/components', () => {
  const create = (tag: any) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span'), Button: create('button') }
})
vi.mock('@tarojs/taro', () => ({ default: taroMock }))
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ fetchByCategory: fetchMock, markItemRead: markMock }),
}))
vi.mock('@/components/notification-badge-sync', () => ({
  notifyNotificationsUpdated: notifyMock,
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
vi.mock('@/lib/date-utils', () => ({ formatDateTimeInChina: () => '2026-01-01' }))

describe('系统通知页', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue({ rows, error: null })
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    fetchMock.mockResolvedValue({ rows, error: null })
  })

  it('默认全部 tab 渲染全部通知，未读项显示「标记已读」', async () => {
    render(<NotificationSystemPage />)
    await screen.findByText('维护通知')
    expect(screen.getByText('已读通知')).toBeTruthy()
    expect(screen.getByText('标记已读')).toBeTruthy()
  })

  it('切换到未读 tab 只显示未读项', async () => {
    render(<NotificationSystemPage />)
    await screen.findByText('维护通知')
    fireEvent.click(screen.getByText('未读', { exact: false }))
    expect(screen.queryByText('已读通知')).toBeNull()
    expect(screen.getByText('维护通知')).toBeTruthy()
  })

  it('点击「标记已读」调用 markItemRead 并广播更新', async () => {
    render(<NotificationSystemPage />)
    await screen.findByText('维护通知')
    await act(async () => {
      fireEvent.click(screen.getByText('标记已读'))
    })
    expect(markMock).toHaveBeenCalledWith('system', '1')
    expect(notifyMock).toHaveBeenCalled()
  })
})
