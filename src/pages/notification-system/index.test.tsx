// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

const { taroMock, fetchMock, markCategoryMock, notifyMock, hideHolder } = vi.hoisted(() => ({
  taroMock: { showToast: vi.fn() },
  fetchMock: vi.fn(() => Promise.resolve({ rows: [] as any[], error: null })),
  markCategoryMock: vi.fn(() => Promise.resolve(true)),
  notifyMock: vi.fn(),
  hideHolder: { cb: () => {} },
}))

vi.mock('@tarojs/components', () => {
  const create = (tag: any) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span'), Button: create('button') }
})
vi.mock('@tarojs/taro', () => ({
  default: taroMock,
  useDidHide: (cb: () => void) => {
    hideHolder.cb = cb
  },
}))
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ fetchByCategory: fetchMock, markCategoryRead: markCategoryMock }),
}))
vi.mock('@/components/notification-badge-sync', () => ({
  notifyNotificationsUpdated: notifyMock,
}))
vi.mock('@/context/theme-context', () => ({ useThemeClass: () => '' }))
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

vi.mock('@/i18n', async () => {
  const mod = await import('@/i18n/messages/zh-CN')
  const dict = mod.zhCN as Record<string, unknown>
  const get = (k: string, p?: Record<string, unknown>): string => {
    const val = k.split('.').reduce<unknown>((o, key) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[key] : undefined), dict)
    let s = typeof val === 'string' ? val : k
    if (p) s = s.replace(/\{(\w+)\}/g, (_, key) => (p[key] !== undefined ? String(p[key]) : `{${key}}`))
    return s
  }
  return { useT: () => ({ t: (k: string, p?: Record<string, unknown>) => get(k, p), locale: 'zh-CN', setLocale: vi.fn() }), useNavTitle: vi.fn() }
})

describe('系统通知页', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue({ rows, error: null })
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    fetchMock.mockResolvedValue({ rows, error: null })
  })

  it('进入页面即把未读标为已读，未读 tab 按快照仍显示', async () => {
    render(<NotificationSystemPage />)
    await waitFor(() => expect(markCategoryMock).toHaveBeenCalledWith('system', ['1']))
    // 快照：刚被标读的「维护通知」本会话内仍在未读 tab；原已读项不出现在此
    expect(await screen.findByText('维护通知')).toBeTruthy()
    expect(screen.queryByText('已读通知')).toBeNull()
  })

  it('切换到已读 tab 只显示已读项', async () => {
    render(<NotificationSystemPage />)
    await screen.findByText('维护通知')
    fireEvent.click(screen.getByText('已读'))
    expect(screen.getByText('已读通知')).toBeTruthy()
    expect(screen.queryByText('维护通知')).toBeNull()
  })

  it('离开时兜底提交不重复标记（成功过的 id 已在 handled 中）', async () => {
    render(<NotificationSystemPage />)
    await waitFor(() => expect(markCategoryMock).toHaveBeenCalledTimes(1))
    await act(async () => {
      hideHolder.cb()
    })
    expect(markCategoryMock).toHaveBeenCalledTimes(1)
  })
})
