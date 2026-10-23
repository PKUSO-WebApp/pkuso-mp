// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { resetTestLocale, setTestLocale } from '@/test-utils/i18n-mock'
import Score from './index'

const { authState } = vi.hoisted(() => ({
  /** user 为 null = 游客；role 是 useMyProfile 给出的当前账号角色 */
  authState: { user: { id: 'u1' } as { id: string } | null, role: 'member' as string | null },
}))

vi.mock('@tarojs/components', () => {
  const create = (tag: any) => (props: any) => {
    const { hoverClass, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span'), ScrollView: create('div') }
})
vi.mock('@tarojs/taro', () => ({
  default: { navigateTo: vi.fn() },
  useDidShow: () => {},
}))
vi.mock('@/context/theme-context', () => ({ useThemeClass: () => '' }))
vi.mock('@/context/user-context', () => ({ useUser: () => ({ user: authState.user }) }))
// ⚠️ 稳定引用（见 members 测试同款注释）：返回同一个对象，改 role = 改它
vi.mock('@/hooks/useMyProfile', () => ({
  useMyProfile: () => ({ profile: { role: authState.role } }),
}))
vi.mock('@/hooks/useSheetMusic', () => ({
  useSheetMusic: () => ({
    items: [],
    myPartsBySheet: {},
    loading: false,
    error: null,
    fetch: vi.fn(),
  }),
  fetchSheetMusicFile: vi.fn(),
}))
// 这两个 hook 都 import 了 supabase（缺 env 时导入即抛），本测试只关心角色闸门
vi.mock('@/hooks/useSharedScoreFiles', () => ({
  useSharedScoreFiles: () => ({ data: [], loading: false, error: null, fetch: vi.fn() }),
}))
vi.mock('@/hooks/useMySharedScopes', () => ({
  useMySharedScopes: () => ({ managedSections: [], capabilities: [], loading: false }),
}))
vi.mock('@/components/staff-blocked-page', () => ({
  // 渲染出角色而不是 null：既证明阻断命中了，也证明 role 传对了
  StaffBlockedPage: ({ role }: { role: string | null }) =>
    React.createElement('span', null, `BLOCKED:${role}`),
}))
vi.mock('@/components/ui/ListState', () => ({
  ListState: ({ children, emptyText }: any) =>
    React.createElement('div', null, children ?? React.createElement('span', null, emptyText)),
}))

vi.mock('@/i18n', async () => {
  const { createI18nMock } = await import('@/test-utils/i18n-mock')
  return createI18nMock()
})

beforeEach(() => {
  resetTestLocale()
  authState.user = { id: 'u1' }
  authState.role = 'member'
})
afterEach(() => cleanup())

describe('谱务 tab 页的角色闸门', () => {
  it.each(['admin', 'score_manager'])('%s：显示阻断页且把角色传下去', (role) => {
    authState.role = role
    render(<Score />)

    expect(screen.getByText(`BLOCKED:${role}`)).toBeTruthy()
  })

  it('member 不被阻断（对照组：证明这个闸门不是恒真的）', () => {
    render(<Score />)

    expect(screen.queryByText(/^BLOCKED:/)).toBeNull()
  })

  it('英文环境：游客提示显示英文', () => {
    setTestLocale('en')
    authState.user = null
    authState.role = 'admin'
    render(<Score />)

    expect(screen.getByText('Please log in on the "Me" page to view')).toBeTruthy()
    expect(screen.queryByText('请在「我的」页面登录以查看')).toBeNull()
  })

  it('游客优先走游客分支，不被角色闸门误伤', () => {
    // 无 user 时 useMyProfile 可能误查到别人的行（比如 admin），闸门必须排在游客分支之后
    authState.user = null
    authState.role = 'admin'
    render(<Score />)

    expect(screen.queryByText(/^BLOCKED:/)).toBeNull()
    expect(screen.getByText('请在「我的」页面登录以查看')).toBeTruthy()
  })
})
