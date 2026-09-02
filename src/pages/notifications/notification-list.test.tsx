// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { NotificationList } from './notification-list'

const rows = [
  {
    id: '1',
    category: 'activity' as const,
    title: '帖子已被锁定',
    content: '你的重奏帖子《重奏A》已被管理员锁定',
    created_at: '2026-01-01T10:00:00',
    read_at: null,
  },
  {
    id: '2',
    category: 'activity' as const,
    title: '帖子已被删除',
    content: '你的团建帖子《团建B》已被管理员删除',
    created_at: '2026-01-02T10:00:00',
    read_at: null,
  },
  {
    id: '3',
    category: 'activity' as const,
    title: '系统维护',
    content: '与帖子无关的通知',
    created_at: '2026-01-03T10:00:00',
    read_at: '2026-01-03T11:00:00',
  },
]

const fetchMock = vi.hoisted(() => ({
  fn: vi.fn(),
  markMock: vi.fn(async () => true),
}))

vi.mock('@tarojs/components', () => {
  const create = (tag: any) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span') }
})
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ fetchByCategory: fetchMock.fn, markCategoryRead: fetchMock.markMock }),
}))
vi.mock('@/components/notification-badge-sync', () => ({
  notifyNotificationsUpdated: vi.fn(),
}))
vi.mock('@/lib/date-utils', () => ({ formatDateTimeInChina: () => '2026-01-01' }))
vi.mock('@/i18n', async () => {
  const mod = await import('@/i18n/messages/zh-CN')
  const dict = mod.zhCN as Record<string, unknown>
  const get = (k: string): string => {
    const val = k
      .split('.')
      .reduce<unknown>(
        (o, key) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[key] : undefined),
        dict
      )
    return typeof val === 'string' ? val : k
  }
  return { useT: () => ({ t: get, locale: 'zh-CN', setLocale: vi.fn() }), useNavTitle: vi.fn() }
})

beforeEach(() => {
  fetchMock.fn.mockResolvedValue({ rows, error: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('NotificationList typeFilter（活动页三 tab 实筛选）', () => {
  it('不传 / all：全量展示', async () => {
    render(<NotificationList category='activity' title='活动通知' />)
    await waitFor(() => expect(screen.getByText('帖子已被锁定')).toBeTruthy())
    expect(screen.getByText('帖子已被删除')).toBeTruthy()
    expect(screen.getByText('系统维护')).toBeTruthy()

    cleanup()
    render(<NotificationList category='activity' title='活动通知' typeFilter='all' />)
    await waitFor(() => expect(screen.getByText('帖子已被锁定')).toBeTruthy())
    expect(screen.getByText('帖子已被删除')).toBeTruthy()
  })

  it('ensemble：只显示归类为重奏的通知；标记已读仍覆盖全量', async () => {
    render(<NotificationList category='activity' title='活动通知' typeFilter='ensemble' />)
    await waitFor(() => expect(screen.getByText('帖子已被锁定')).toBeTruthy())
    expect(screen.queryByText('帖子已被删除')).toBeNull()
    expect(screen.queryByText('系统维护')).toBeNull()
    // 曝光语义不变：未读标记覆盖该分类全部未读（含团建那条），已读的排除
    await waitFor(() => expect(fetchMock.markMock).toHaveBeenCalledWith('activity', ['1', '2']))
  })

  it('gathering：只显示归类为团建的通知', async () => {
    render(<NotificationList category='activity' title='活动通知' typeFilter='gathering' />)
    await waitFor(() => expect(screen.getByText('帖子已被删除')).toBeTruthy())
    expect(screen.queryByText('帖子已被锁定')).toBeNull()
    expect(screen.queryByText('系统维护')).toBeNull()
  })

  it('筛选后为空显示空态', async () => {
    fetchMock.fn.mockResolvedValue({
      rows: [{ ...rows[2] }],
      error: null,
    })
    render(<NotificationList category='activity' title='活动通知' typeFilter='ensemble' />)
    await waitFor(() => expect(screen.getByText('暂无消息')).toBeTruthy())
  })
})
