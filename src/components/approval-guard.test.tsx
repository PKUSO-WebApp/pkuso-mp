// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { EntryProfile } from '@/lib/profile-gate'
import { ApprovalGuard } from './approval-guard'

vi.mock('@tarojs/components', () => {
  const create = (tag: string) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span'), Button: create('button') }
})

const { taroMock } = vi.hoisted(() => {
  const mock = { reLaunch: vi.fn() }
  ;(mock as unknown as Record<string, unknown>).default = mock
  return { taroMock: mock }
})
vi.mock('@tarojs/taro', () => taroMock)

// 可变 mock 状态（组件只消费这两个 context + 两个 hook）
const { userCtx, profileCtx, logoutCtx } = vi.hoisted(() => ({
  userCtx: { user: null as { id: string } | null, ready: true },
  profileCtx: {
    profile: null as EntryProfile | null,
    loading: false,
    error: null as string | null,
  },
  logoutCtx: { signingOut: false },
}))
const { logoutMock, refreshMock } = vi.hoisted(() => ({
  logoutMock: vi.fn(),
  refreshMock: vi.fn(),
}))

vi.mock('@/context/user-context', () => ({ useUser: () => userCtx }))
vi.mock('@/context/theme-context', () => ({ useThemeClass: () => '' }))
vi.mock('@/hooks/useLogout', () => ({
  useLogout: () => ({ signingOut: logoutCtx.signingOut, logout: logoutMock }),
}))
vi.mock('@/hooks/useProfileStatus', () => ({
  useProfileStatus: () => ({
    profile: profileCtx.profile,
    loading: profileCtx.loading,
    error: profileCtx.error,
    refresh: refreshMock,
  }),
}))

const makeProfile = (overrides: Partial<EntryProfile> = {}): EntryProfile => ({
  full_name: '张三',
  email: 'zhangsan@example.com',
  status: 'pending',
  ...overrides,
})

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
describe('ApprovalGuard', () => {
  beforeEach(() => {
    userCtx.user = { id: 'u1' }
    userCtx.ready = true
    profileCtx.profile = null
    profileCtx.loading = false
    profileCtx.error = null
    logoutCtx.signingOut = false
    taroMock.reLaunch.mockClear()
    logoutMock.mockReset()
    refreshMock.mockReset()
    refreshMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
  })

  it('pending 页：显示等待审核文案与操作按钮', () => {
    profileCtx.profile = makeProfile({ status: 'pending' })
    render(<ApprovalGuard expected='pending' />)
    expect(screen.getByText('等待管理员审核')).toBeTruthy()
    expect(screen.getByText('资料已提交，管理员审核通过后即可使用小程序。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '刷新状态' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '退出登录' })).toBeTruthy()
  })

  it('rejected 页：显示审核未通过文案', () => {
    profileCtx.profile = makeProfile({ status: 'rejected' })
    render(<ApprovalGuard expected='rejected' />)
    expect(screen.getByText('审核未通过，请联系管理员')).toBeTruthy()
  })

  it('approved：自动 reLaunch 首页（管理员通过后无需手动操作）', async () => {
    profileCtx.profile = makeProfile({ status: 'approved' })
    render(<ApprovalGuard expected='pending' />)
    await waitFor(() =>
      expect(taroMock.reLaunch).toHaveBeenCalledWith({ url: '/pages/index/index' })
    )
  })

  it('状态与本页不符：pending 页上 profile 变为 rejected → 跳 rejected 页', async () => {
    profileCtx.profile = makeProfile({ status: 'rejected' })
    render(<ApprovalGuard expected='pending' />)
    await waitFor(() =>
      expect(taroMock.reLaunch).toHaveBeenCalledWith({ url: '/pages/rejected/index' })
    )
  })

  it('未登录：回登录页', async () => {
    userCtx.user = null
    render(<ApprovalGuard expected='pending' />)
    await waitFor(() =>
      expect(taroMock.reLaunch).toHaveBeenCalledWith({ url: '/pages/login/index' })
    )
  })

  it('会话恢复完成前：显示加载占位，不跳转', () => {
    userCtx.ready = false
    render(<ApprovalGuard expected='pending' />)
    expect(screen.getByText('加载中…')).toBeTruthy()
    expect(taroMock.reLaunch).not.toHaveBeenCalled()
  })

  it('首次查询失败且无 profile：显示错误文案', () => {
    profileCtx.error = '网络异常，请重试'
    render(<ApprovalGuard expected='pending' />)
    expect(screen.getByText('网络异常，请重试')).toBeTruthy()
  })

  it('点击刷新状态触发 refresh；点击退出登录触发 logout', () => {
    profileCtx.profile = makeProfile({ status: 'pending' })
    render(<ApprovalGuard expected='pending' />)
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))
    expect(refreshMock).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    expect(logoutMock).toHaveBeenCalled()
  })
})

