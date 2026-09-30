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

const activityRows = [
  {
    id: '3',
    category: 'activity' as const,
    title: '活动通知A',
    content: '活动内容',
    created_at: '2026-01-03T10:00:00',
    read_at: null,
  },
]

const { taroMock, fetchMock, markCategoryMock, notifyMock, hideHolder } = vi.hoisted(() => ({
  taroMock: { showToast: vi.fn() },
  // 显式标注返回类型：否则被推断成 error: null，后面模拟失败态就赋不进 'loadFailed'
  fetchMock: vi.fn((category?: string): Promise<{ rows: any[]; error: string | null }> =>
    Promise.resolve({
      rows: category === 'activity' ? (activityRows as any[]) : (rows as any[]),
      error: null,
    })
  ),
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

describe('系统通知页', () => {
  beforeEach(() => {
    fetchMock.mockImplementation((category?: string) =>
      Promise.resolve({ rows: category === 'activity' ? activityRows : rows, error: null })
    )
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    fetchMock.mockImplementation((category?: string) =>
      Promise.resolve({ rows: category === 'activity' ? activityRows : rows, error: null })
    )
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
    await waitFor(() => expect(markCategoryMock).toHaveBeenCalledTimes(2))
    await act(async () => {
      hideHolder.cb()
    })
    expect(markCategoryMock).toHaveBeenCalledTimes(2)
  })

  it('两类都失败时给重试入口；重试会重新取数并恢复内容', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ rows: [], error: 'loadFailed' as const }))
    const callsAfterFirstLoad = fetchMock.mock.calls.length
    render(<NotificationSystemPage />)
    // 失败文案与重试按钮都得出现——光有文案没有入口就是「只能退出重进」
    expect(await screen.findByText('加载失败，请稍后重试')).toBeTruthy()
    const retry = screen.getByText('重试')
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirstLoad + 2) // system + activity

    // 放行网络后再点：断言的是「真的又发了一次请求」，不只是按钮被点过
    fetchMock.mockImplementation((category?: string) =>
      Promise.resolve({ rows: category === 'activity' ? activityRows : rows, error: null })
    )
    fireEvent.click(retry)

    expect(await screen.findByText('维护通知')).toBeTruthy()
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirstLoad + 4)
    // 内容回来后失败态（含按钮）必须撤掉，否则用户会以为还得再点
    expect(screen.queryByText('加载失败，请稍后重试')).toBeNull()
    expect(screen.queryByText('重试')).toBeNull()
  })
})
