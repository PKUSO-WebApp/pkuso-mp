// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { UserContextValue } from '@/context/user-context'
import { ThemeProvider } from '@/context/theme-context'
import EmailLoginPage from './index'

// @tarojs/components mock：Input 需把 DOM input 事件桥接成 Taro 的 { detail: { value } }
vi.mock('@tarojs/components', () => {
  const create = (tag: 'div' | 'span' | 'button') => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  const Input = (props: any) => {
    // password 是 Taro 专有布尔属性，桥接时丢弃避免 DOM 告警
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
  }
  return { ctx: state }
})
vi.mock('@/context/user-context', () => ({ useUser: () => ctx }))

const { authMock, supabaseMock } = vi.hoisted(() => {
  const auth = {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    getUser: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
  }
  return { authMock: auth, supabaseMock: { auth } }
})
vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }))

const renderPage = () =>
  render(
    <ThemeProvider>
      <EmailLoginPage />
    </ThemeProvider>
  )

describe('EmailLoginPage', () => {
  beforeEach(() => {
    ctx.ready = true
    ctx.user = null
    ctx.session = null
    authMock.getUser.mockReset()
    authMock.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    authMock.signOut.mockReset()
    authMock.signOut.mockResolvedValue({ error: null })
    authMock.signInWithPassword.mockReset()
    authMock.signInWithPassword.mockResolvedValue({ data: { session: null }, error: null })
    authMock.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    taroMock.reLaunch.mockClear()
    taroMock.navigateTo.mockClear()
    taroMock.navigateBack.mockClear()
    routeAfterLoginMock.mockReset()
    routeAfterLoginMock.mockResolvedValue(undefined)
  })

  afterEach(() => cleanup())

  it('渲染邮箱/密码表单与登录按钮', () => {
    renderPage()
    expect(screen.getByPlaceholderText('name@example.com')).toBeTruthy()
    expect(screen.getByPlaceholderText('请输入密码')).toBeTruthy()
    expect(screen.getByRole('button', { name: '登录' })).toBeTruthy()
    // 顶部返回与底部注册入口
    expect(screen.getByText('返回微信登录 <')).toBeTruthy()
    expect(screen.getByText('使用邮箱注册')).toBeTruthy()
  })

  it('点击「返回微信登录 <」调用 navigateBack', () => {
    renderPage()
    fireEvent.click(screen.getByText('返回微信登录 <'))
    expect(taroMock.navigateBack).toHaveBeenCalled()
  })

  it('点击「使用邮箱注册」路由到邮箱注册页', () => {
    renderPage()
    fireEvent.click(screen.getByText('使用邮箱注册'))
    expect(taroMock.navigateTo).toHaveBeenCalledWith({ url: '/pages/email-signup/index' })
  })

  it('提交路径：输入邮箱密码并点击登录，调用 signInWithPassword 后按 profile 状态路由入口', async () => {
    renderPage()
    fireEvent.input(screen.getByPlaceholderText('name@example.com'), {
      target: { value: 'test@example.com' },
    })
    fireEvent.input(screen.getByPlaceholderText('请输入密码'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() =>
      expect(authMock.signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      })
    )
    await waitFor(() => expect(routeAfterLoginMock).toHaveBeenCalledWith(supabaseMock))
  })

  it('密码错误时显示映射后的页内错误文案', async () => {
    authMock.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid login credentials' },
    })
    renderPage()
    fireEvent.input(screen.getByPlaceholderText('name@example.com'), {
      target: { value: 'test@example.com' },
    })
    fireEvent.input(screen.getByPlaceholderText('请输入密码'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() => expect(screen.getByText('邮箱或密码错误')).toBeTruthy())
    expect(taroMock.reLaunch).not.toHaveBeenCalled()
  })

  it('空输入校验：点击登录显示提示且不调用接口', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() => expect(screen.getByText('请输入邮箱和密码。')).toBeTruthy())
    expect(authMock.signInWithPassword).not.toHaveBeenCalled()
  })
})
