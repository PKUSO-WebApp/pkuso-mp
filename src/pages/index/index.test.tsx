// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import Index from './index'

vi.mock('@tarojs/components', () => {
  const create = (tag: 'div' | 'span' | 'button') => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  const Picker = (props: any) => React.createElement('div', props)
  const Input = (props: any) => React.createElement('input', props)
  return {
    View: create('div'),
    Text: create('span'),
    Button: create('button'),
    ScrollView: create('div'),
    Picker,
    Input,
  }
})

vi.mock('@tarojs/taro', () => ({
  default: {
    showToast: vi.fn(),
    showModal: vi.fn(),
    reLaunch: vi.fn(),
    navigateTo: vi.fn(),
    setTabBarBadge: vi.fn(),
    removeTabBarBadge: vi.fn(),
    stopPullDownRefresh: vi.fn(),
  },
  useDidShow: vi.fn(),
  usePullDownRefresh: vi.fn(),
}))

vi.mock('@/context/theme-context', () => ({ useThemeClass: () => '' }))
vi.mock('@/context/user-context', () => ({ useUser: () => ({ user: { id: 'u1' } }) }))
vi.mock('@/hooks/useMyProfile', () => ({ useMyProfile: () => ({ profile: { role: 'member' } }) }))
vi.mock('@/hooks/useLeaveRequests', () => ({
  useLeaveRequests: () => ({ data: [], cancelOnSignIn: vi.fn(), fetchMine: vi.fn() }),
}))
vi.mock('@/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({ data: null, loading: false, error: null, fetch: vi.fn() }),
}))
vi.mock('@/lib/dataSync', () => ({ dataSyncBump: vi.fn() }))
vi.mock('@/components/admin-blocked-page', () => ({ AdminBlockedPage: () => null }))
vi.mock('@/components/ui/Card', () => ({
  Card: ({ children, ...rest }: any) => React.createElement('div', rest, children),
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
vi.mock('@/pages/index/components/rehearsal-card', () => ({
  RehearsalCard: ({ item, onClick }: any) =>
    React.createElement('div', { 'data-testid': `card-${item.id}`, onClick }, item.repertoire),
}))

const mk = (id: number, type: string, repertoire: string, offsetDays: number) => {
  const start = new Date(Date.now() + offsetDays * 86400000)
  const end = new Date(start.getTime() + 3 * 3600000)
  const iso = (d: Date) => d.toISOString().slice(0, 19)
  return {
    id,
    type,
    repertoire,
    start_time: iso(start),
    end_time: iso(end),
    location: 'A',
    updated_at: null,
    created_at: null,
  }
}

vi.mock('@/hooks/useRehearsals', () => ({
  useRehearsals: () => ({
    data: [
      mk(1, 'full', '未来合排', 2),
      mk(2, 'full', '历史合排1', -2000),
      mk(3, 'section', '分排排练', 3),
    ],
    loading: false,
    error: null,
  }),
}))

vi.mock('@/hooks/useAttendance', () => ({
  useAttendance: () => ({ map: {}, loading: false, fetchMyAttendances: vi.fn(), signIn: vi.fn() }),
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
describe('首页排练页', () => {
  afterEach(() => {
    cleanup()
  })

  it('默认「合排」tab 不显示已结束的历史合排', () => {
    render(<Index />)
    expect(screen.getByText('未来合排')).toBeTruthy()
    expect(screen.queryByText('历史合排1')).toBeNull()
    expect(screen.queryByText('分排排练')).toBeNull()
  })

  it('切到「历史日程」tab 只显示已结束的合排，不含分排与未来排练', () => {
    render(<Index />)
    fireEvent.click(screen.getByText('历史日程'))
    expect(screen.getByText('历史合排1')).toBeTruthy()
    expect(screen.queryByText('未来合排')).toBeNull()
    expect(screen.queryByText('分排排练')).toBeNull()
  })

  it('点击排练卡片跳转到详情页', () => {
    const { getByTestId } = render(<Index />)
    fireEvent.click(getByTestId('card-1'))
    expect(vi.mocked(Taro.navigateTo).mock.calls[0][0]).toMatchObject({
      url: '/pages/rehearsal-detail/index?id=1',
    })
  })
})
