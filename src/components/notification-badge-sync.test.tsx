// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { getTabBarUnread, setTabBarUnread } from '@/lib/tabBarBadge'
import { NotificationBadgeSync, NOTIFICATION_UPDATED_EVENT } from './notification-badge-sync'

const { taroMock, notif, userMock } = vi.hoisted(() => ({
  taroMock: {
    useDidShow: vi.fn(),
    eventCenter: { on: vi.fn(), off: vi.fn(), trigger: vi.fn() },
  },
  notif: { totalUnread: 0, refresh: vi.fn() },
  userMock: { user: { id: 'u1' } },
}))

vi.mock('@tarojs/taro', () => ({ default: taroMock, useDidShow: taroMock.useDidShow }))
vi.mock('@/context/user-context', () => ({ useUser: () => ({ user: userMock.user }) }))
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ totalUnread: notif.totalUnread, refresh: notif.refresh }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  // 复位模块级红点 store，避免用例间串扰
  setTabBarUnread(0)
})

describe('NotificationBadgeSync 红点', () => {
  it('会话就绪（user 出现）即拉取未读数（冷启动刷新）', () => {
    render(
      <NotificationBadgeSync>
        <div />
      </NotificationBadgeSync>
    )
    expect(notif.refresh).toHaveBeenCalled()
  })

  it('未读数 > 0 写入模块 store（custom tabBar 据此渲染红点）', () => {
    notif.totalUnread = 3
    render(
      <NotificationBadgeSync>
        <div />
      </NotificationBadgeSync>
    )
    expect(getTabBarUnread()).toBe(3)
  })

  it('未读数为 0 时 store 为 0（无红点）', () => {
    notif.totalUnread = 0
    render(
      <NotificationBadgeSync>
        <div />
      </NotificationBadgeSync>
    )
    expect(getTabBarUnread()).toBe(0)
  })

  it('监听通知更新事件，profile 标记已读后重新拉取', () => {
    let handler: (() => void) | undefined
    taroMock.eventCenter.on.mockImplementation((_e: string, h: () => void) => {
      handler = h
    })
    render(
      <NotificationBadgeSync>
        <div />
      </NotificationBadgeSync>
    )
    expect(taroMock.eventCenter.on).toHaveBeenCalledWith(
      NOTIFICATION_UPDATED_EVENT,
      expect.any(Function)
    )
    expect(handler).toBeTypeOf('function')
    const before = notif.refresh.mock.calls.length
    handler!()
    expect(notif.refresh.mock.calls.length).toBe(before + 1)
  })
})
