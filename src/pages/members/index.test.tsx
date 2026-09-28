// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Members from './index'

const member = {
  id: 'p1',
  full_name: '王小明',
  instrument: '小提琴',
  role: 'member',
  is_section_leader: false,
  is_in_orchestra: true,
}

const { useProfilesMockState, fetchMock } = vi.hoisted(() => ({
  useProfilesMockState: {
    data: [] as unknown[],
    loading: false,
    error: null as string | null,
  },
  fetchMock: vi.fn(),
}))

vi.mock('@tarojs/components', () => {
  const create = (tag: any) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span'), ScrollView: create('div') }
})
vi.mock('@tarojs/taro', () => ({
  default: { stopPullDownRefresh: vi.fn() },
  // 首页那次/切回 tab 那次都用它触发 fetch——此处置空，让 fetch 的调用次数只由「重试」决定
  useDidShow: vi.fn(),
  usePullDownRefresh: vi.fn(),
}))
vi.mock('@/hooks/useProfiles', () => ({
  useProfiles: () => ({
    data: useProfilesMockState.data,
    loading: useProfilesMockState.loading,
    error: useProfilesMockState.error,
    fetch: fetchMock,
  }),
}))
vi.mock('@/hooks/useMyProfile', () => ({ useMyProfile: () => ({ profile: { role: 'member' } }) }))
vi.mock('@/context/user-context', () => ({ useUser: () => ({ user: { id: 'me' } }) }))
vi.mock('@/context/theme-context', () => ({ useThemeClass: () => '' }))
vi.mock('@/hooks/usePlaceholderStyle', () => ({ usePlaceholderStyle: () => ({}) }))
vi.mock('@/components/admin-blocked-page', () => ({ AdminBlockedPage: () => null }))
vi.mock('@/components/ui/StatusChip', () => ({
  StatusChip: ({ children }: any) => React.createElement('span', null, children),
}))
vi.mock('./components/member-detail-modal', () => ({ MemberDetailModal: () => null }))
vi.mock('@/components/ui/FormFields', () => ({
  TextField: ({ value, onInput, placeholder }: any) =>
    React.createElement('input', {
      value,
      placeholder,
      onChange: (e: any) => onInput({ detail: { value: e.target.value } }),
    }),
}))
vi.mock('@/lib/instrument-i18n', () => ({
  translateInstrument: (g: string) => g,
  matchInstrumentSection: () => null,
}))
vi.mock('@/lib/join-date-i18n', () => ({ translateJoinDate: (d: string) => d }))

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
  const t = (k: string, p?: Record<string, unknown>) => get(k, p)
  const ctx = { t, locale: 'zh-CN', setLocale: () => {} }
  return { useT: () => ctx, useNavTitle: vi.fn() }
})

describe('花名册页失败态与空态', () => {
  beforeEach(() => {
    useProfilesMockState.data = []
    useProfilesMockState.loading = false
    useProfilesMockState.error = null
    fetchMock.mockReset()
  })
  afterEach(() => {
    cleanup()
  })

  it('加载失败时给重试入口；点重试会重新拉取', () => {
    useProfilesMockState.error = 'loadFailed'
    render(<Members />)

    expect(screen.getByText('数据加载失败，请重试')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('重试'))
    // 断言的是「真的又拉了一次」，不只是按钮被点过
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('两种空态各说各话：花名册为空 vs 搜不到匹配', () => {
    render(<Members />)
    expect(screen.getByText('暂无已通过成员')).toBeTruthy()
    expect(screen.queryByText('未找到匹配的成员')).toBeNull()

    cleanup()
    useProfilesMockState.data = [member]
    const { container } = render(<Members />)
    expect(screen.queryByText('暂无已通过成员')).toBeNull()

    fireEvent.change(container.querySelector('input')!, { target: { value: 'zzz' } })
    expect(screen.getByText('未找到匹配的成员')).toBeTruthy()
    expect(screen.queryByText('暂无已通过成员')).toBeNull()
  })
})
