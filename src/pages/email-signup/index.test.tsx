// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { UserContextValue } from '@/context/user-context'
import { ThemeProvider } from '@/context/theme-context'
import EmailSignupPage from './index'

// @tarojs/components mock
vi.mock('@tarojs/components', () => {
  const create = (tag: 'div' | 'span' | 'button') => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  const Input = (props: any) => {
    const { onInput, password: _password, ...rest } = props
    return React.createElement('input', {
      ...rest,
      onInput: (e: any) => onInput?.({ detail: { value: e.target.value } }),
    })
  }
  return { View: create('div'), Text: create('span'), Button: create('button'), Input }
})

const { taroMock } = vi.hoisted(() => {
  const mock = {
    reLaunch: vi.fn(),
    navigateTo: vi.fn(),
    navigateBack: vi.fn(),
    showToast: vi.fn(),
    getSystemInfoSync: vi.fn(() => ({ theme: 'light' })),
    setNavigationBarColor: vi.fn(() => Promise.resolve()),
    setBackgroundColor: vi.fn(() => Promise.resolve()),
    setTabBarStyle: vi.fn(() => Promise.resolve()),
    onThemeChange: vi.fn(),
    offThemeChange: vi.fn(),
    getStorage: vi.fn(() => Promise.resolve({ data: null })),
    setStorage: vi.fn(() => Promise.resolve()),
  }
  ;(mock as unknown as Record<string, unknown>).default = mock
  return { taroMock: mock }
})
vi.mock('@tarojs/taro', () => taroMock)

const { routeAfterLoginMock } = vi.hoisted(() => ({ routeAfterLoginMock: vi.fn() }))
vi.mock('@/lib/post-auth-route', () => ({ routeAfterLogin: routeAfterLoginMock }))

const { ctx } = vi.hoisted(() => {
  const state: UserContextValue = {
    session: null,
    user: null,
    ready: true,
    restoreFailed: false,
    forcedOfflineAt: null,
    forcedOffline: false,
    clearForcedOffline: vi.fn(),
  }
  return { ctx: state }
})
vi.mock('@/context/user-context', () => ({ useUser: () => ctx }))

const { authMock, supabaseMock } = vi.hoisted(() => {
  const auth = {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    getUser: vi.fn(),
    signOut: vi.fn(),
    signUp: vi.fn(),
  }
  return { authMock: auth, supabaseMock: { auth } }
})
vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }))

const fillForm = (overrides: Partial<Record<string, string>> = {}) => {
  fireEvent.input(screen.getByPlaceholderText('name@example.com'), {
    target: { value: overrides.email ?? 'new@example.com' },
  })
  fireEvent.input(screen.getByPlaceholderText('至少 6 位'), {
    target: { value: overrides.password ?? 'password123' },
  })
  fireEvent.input(screen.getByPlaceholderText('再次输入密码'), {
    target: { value: overrides.confirm ?? 'password123' },
  })
  fireEvent.input(screen.getByPlaceholderText('请输入真实姓名'), {
    target: { value: overrides.name ?? '张三' },
  })
}

const renderPage = () =>
  render(
    <ThemeProvider>
      <EmailSignupPage />
    </ThemeProvider>
  )

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
describe('EmailSignupPage', () => {
  beforeEach(() => {
    ctx.ready = true
    ctx.user = null
    ctx.session = null
    authMock.getUser.mockReset()
    authMock.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    authMock.signOut.mockReset()
    authMock.signOut.mockResolvedValue({ error: null })
    authMock.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    authMock.signUp.mockReset()
    taroMock.reLaunch.mockClear()
    taroMock.navigateTo.mockClear()
    taroMock.navigateBack.mockClear()
    taroMock.showToast.mockClear()
    routeAfterLoginMock.mockReset()
    routeAfterLoginMock.mockResolvedValue(undefined)
  })

  afterEach(() => cleanup())

  it('渲染四个字段与注册按钮', () => {
    renderPage()
    expect(screen.getByPlaceholderText('name@example.com')).toBeTruthy()
    expect(screen.getByPlaceholderText('至少 6 位')).toBeTruthy()
    expect(screen.getByPlaceholderText('再次输入密码')).toBeTruthy()
    expect(screen.getByPlaceholderText('请输入真实姓名')).toBeTruthy()
    expect(screen.getByRole('button', { name: '注册' })).toBeTruthy()
    expect(screen.getByText('返回')).toBeTruthy()
  })

  it('点击「返回」调用 navigateBack', () => {
    renderPage()
    fireEvent.click(screen.getByText('返回'))
    expect(taroMock.navigateBack).toHaveBeenCalled()
  })

  it('空输入校验：点击注册显示提示且不调用接口', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '注册' }))
    await waitFor(() => expect(screen.getByText('请填写完整信息后再提交。')).toBeTruthy())
    expect(authMock.signUp).not.toHaveBeenCalled()
  })

  it('密码长度不足校验', async () => {
    renderPage()
    fillForm({ password: '123', confirm: '123' })
    fireEvent.click(screen.getByRole('button', { name: '注册' }))
    await waitFor(() => expect(screen.getByText('密码长度至少为 6 位，请重新设置。')).toBeTruthy())
    expect(authMock.signUp).not.toHaveBeenCalled()
  })

  it('两次密码不一致校验', async () => {
    renderPage()
    fillForm({ password: 'password123', confirm: 'different123' })
    fireEvent.click(screen.getByRole('button', { name: '注册' }))
    await waitFor(() => expect(screen.getByText('两次输入的密码不一致，请重新输入。')).toBeTruthy())
    expect(authMock.signUp).not.toHaveBeenCalled()
  })

  it('注册成功（自动建立会话）：携带 full_name 调用 signUp 并按 profile 状态路由', async () => {
    authMock.signUp.mockResolvedValue({
      data: { session: { user: { id: 'u2' } }, user: { id: 'u2' } },
      error: null,
    })
    renderPage()
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: '注册' }))
    await waitFor(() =>
      expect(authMock.signUp).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'password123',
        options: { data: { full_name: '张三' } },
      })
    )
    await waitFor(() => expect(routeAfterLoginMock).toHaveBeenCalledWith(supabaseMock))
    // 邮箱验证开启场景不应触发
    expect(taroMock.showToast).not.toHaveBeenCalled()
  })

  it('注册成功但需邮箱验证（无会话）：提示去邮箱验证并延时返回', async () => {
    authMock.signUp.mockResolvedValue({
      data: { session: null, user: { id: 'u2' } },
      error: null,
    })
    renderPage()
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: '注册' }))
    await waitFor(() =>
      expect(taroMock.showToast).toHaveBeenCalledWith({
        title: '注册成功，请前往邮箱验证',
        icon: 'none',
      })
    )
    expect(routeAfterLoginMock).not.toHaveBeenCalled()
    // setTimeout(1200ms) 内才 navigateBack：放宽超时等待真实定时器
    await waitFor(() => expect(taroMock.navigateBack).toHaveBeenCalled(), { timeout: 2000 })
  })

  it('signUp 报错：归一化文案展示', async () => {
    authMock.signUp.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'User already registered' },
    })
    renderPage()
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: '注册' }))
    await waitFor(() => expect(screen.getByText('该邮箱已被注册，请直接登录')).toBeTruthy())
    expect(routeAfterLoginMock).not.toHaveBeenCalled()
  })
})

