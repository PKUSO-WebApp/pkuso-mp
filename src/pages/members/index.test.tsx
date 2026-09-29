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

const { useProfilesMockState, fetchMock, myProfileState } = vi.hoisted(() => ({
  useProfilesMockState: {
    data: [] as unknown[],
    loading: false,
    error: null as string | null,
  },
  fetchMock: vi.fn(),
  /** 当前账号的角色：逐用例可改（阻断分支要看它） */
  myProfileState: { role: 'member' as string | null },
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
vi.mock('@/hooks/useMyProfile', () => ({
  // ⚠️ 返回**稳定引用**（每次渲染都是同一个对象，改 role = 改它）。返回新对象字面量会有
  // 「进了 effect 依赖就无限重渲染」的风险，那是本仓踩过的坑。
  useMyProfile: () => ({ profile: myProfileState }),
}))
vi.mock('@/context/user-context', () => ({ useUser: () => ({ user: { id: 'me' } }) }))
vi.mock('@/context/theme-context', () => ({ useThemeClass: () => '' }))
vi.mock('@/hooks/usePlaceholderStyle', () => ({ usePlaceholderStyle: () => ({}) }))
vi.mock('@/components/staff-blocked-page', () => ({
  // 渲染出角色而不是 null：既证明阻断**命中了**，也证明 role **传对了**
  StaffBlockedPage: ({ role }: { role: string | null }) =>
    React.createElement('span', null, `BLOCKED:${role}`),
}))
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

const rosterRows = [
  { ...member, id: 'p1', full_name: '张三', role: 'member' },
  { ...member, id: 'p2', full_name: '管理员乙', role: 'admin' },
  { ...member, id: 'p3', full_name: '谱务甲', role: 'score_manager' },
  // role 列可空：空值按列默认值 member 算，别静默漏人
  { ...member, id: 'p4', full_name: '空角色丙', role: null },
]

beforeEach(() => {
  useProfilesMockState.data = []
  useProfilesMockState.loading = false
  useProfilesMockState.error = null
  myProfileState.role = 'member'
  fetchMock.mockReset()
})
afterEach(() => {
  cleanup()
})

describe('花名册页失败态与空态', () => {
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

describe('花名册只列团员', () => {
  it('admin 与谱务账号都不出现；role 为空按 member 算，不从名单里静默漏人', () => {
    useProfilesMockState.data = rosterRows
    render(<Members />)

    expect(screen.getByText('张三')).toBeTruthy()
    expect(screen.getByText('空角色丙')).toBeTruthy()
    expect(screen.queryByText('管理员乙')).toBeNull()
    expect(screen.queryByText('谱务甲')).toBeNull()
  })
})

describe('非团员账号被阻断页挡住', () => {
  it.each(['admin', 'score_manager'])('%s：显示阻断页且把角色传下去，名单一行都不渲染', (role) => {
    myProfileState.role = role
    useProfilesMockState.data = rosterRows
    render(<Members />)

    expect(screen.getByText(`BLOCKED:${role}`)).toBeTruthy()
    expect(screen.queryByText('张三')).toBeNull()
  })

  it('member 不被阻断（对照组：证明这个闸门不是恒真的）', () => {
    myProfileState.role = 'member'
    useProfilesMockState.data = rosterRows
    render(<Members />)

    expect(screen.queryByText(/^BLOCKED:/)).toBeNull()
    expect(screen.getByText('张三')).toBeTruthy()
  })
})
