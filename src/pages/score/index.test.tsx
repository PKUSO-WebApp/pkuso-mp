// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
vi.mock('@tarojs/taro', () => ({ default: { navigateTo: vi.fn() } }))
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
  return { useT: () => ({ t, locale: 'zh-CN', setLocale: () => {} }), useNavTitle: vi.fn() }
})

beforeEach(() => {
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

  it('游客优先走游客分支，不被角色闸门误伤', () => {
    // 无 user 时 useMyProfile 可能误查到别人的行（比如 admin），闸门必须排在游客分支之后
    authState.user = null
    authState.role = 'admin'
    render(<Score />)

    expect(screen.queryByText(/^BLOCKED:/)).toBeNull()
    expect(screen.getByText('请在「我的」页面登录以查看')).toBeTruthy()
  })
})
