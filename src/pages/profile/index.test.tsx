// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Profile from './index'

const { taroMock, updateProfileMock, notif, pickerProps } = vi.hoisted(() => ({
  taroMock: {
    showToast: vi.fn(),
    showModal: vi.fn(() => Promise.resolve({ confirm: true })),
    reLaunch: vi.fn(),
    navigateTo: vi.fn(),
    setTabBarBadge: vi.fn(),
    removeTabBarBadge: vi.fn(),
    showTabBarRedDot: vi.fn(() => Promise.resolve()),
    hideTabBarRedDot: vi.fn(() => Promise.resolve()),
    useDidShow: vi.fn(),
  },
  updateProfileMock: vi.fn(async (_id: string, _payload: any) => true),
  notif: { totalUnread: 3 },
  pickerProps: { range: [] as string[] },
}))

vi.mock('@tarojs/components', () => {
  const create = (tag: any) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  const Picker = (props: any) => {
    if (props.range) pickerProps.range = props.range
    return React.createElement(
      'div',
      { onClick: () => props.onChange?.({ detail: { value: 0 } }) },
      props.children
    )
  }
  const Input = (props: any) => React.createElement('input', props)
  return { View: create('div'), Text: create('span'), Button: create('button'), Picker, Input }
})

vi.mock('@tarojs/taro', () => ({ default: taroMock, useDidShow: taroMock.useDidShow }))
vi.mock('@/context/theme-context', () => ({ useThemeClass: () => '' }))
vi.mock('@/context/user-context', () => ({
  useUser: () => ({ user: { id: 'u1', email: 'a@b.com' } }),
}))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ signOut: vi.fn() }) }))
vi.mock('@/lib/profile-gate', () => ({ isSyntheticEmail: () => false }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: { email: 'a@b.com' } } })) },
  },
}))
vi.mock('@/hooks/useProfiles', () => ({
  useProfiles: () => ({
    data: [
      {
        id: 'u1',
        full_name: '张三',
        instrument: '长笛',
        email: 'a@b.com',
        hide_email: false,
        hide_phone: false,
        hide_join_date: false,
        role: 'member',
        college: '',
        join_date: '',
      },
    ],
    loading: false,
    error: null,
    update: updateProfileMock,
  }),
}))
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({
    unreadCounts: { attendance: 1, activity: 1, system: 1 },
    totalUnread: notif.totalUnread,
    refresh: vi.fn(),
    fetchByCategory: vi.fn(),
    markCategoryRead: vi.fn(),
  }),
}))
vi.mock('@/components/admin-blocked-page', () => ({ AdminBlockedPage: () => null }))
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, children }: any) => (open ? React.createElement('div', null, children) : null),
}))
vi.mock('@/components/ui/Toggle', () => ({
  Toggle: ({ options, onChange, getLabel }: any) =>
    React.createElement(
      'div',
      null,
      options.map((o: string) =>
        React.createElement(
          'button',
          { key: o, onClick: () => onChange(o) },
          getLabel ? getLabel(o) : o
        )
      )
    ),
}))
vi.mock('@/lib/validation', () => ({ isValidEmail: () => true, isValidPhoneNumber: () => true }))
vi.mock('@/pages/profile/components/attendance-history-modal', () => ({
  AttendanceHistoryModal: () => null,
}))
vi.mock('@/pages/profile/components/theme-modal', () => ({ ThemeModal: () => null }))
vi.mock('@/pages/profile/components/feedback-modal', () => ({ FeedbackModal: () => null }))

describe('我的页', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('挂载后正常渲染（「我的」红点同步已迁移至全局 NotificationBadgeSync）', () => {
    notif.totalUnread = 3
    render(<Profile />)
    // 页面能正常挂载并渲染关键区块
    expect(screen.getByText('个人信息')).toBeTruthy()
  })

  it('点击「个人信息」跳转到独立个人信息页', () => {
    notif.totalUnread = 0
    render(<Profile />)
    fireEvent.click(screen.getByText('个人信息'))
    expect(taroMock.navigateTo).toHaveBeenCalledWith({ url: '/pages/profile-info/index' })
  })
})
