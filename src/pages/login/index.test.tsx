// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { UserContextValue } from '@/context/user-context'
import { ThemeProvider } from '@/context/theme-context'
import LoginPage from './index'

// @tarojs/components mock
vi.mock('@tarojs/components', () => {
  const create = (tag: 'div' | 'span' | 'button' | 'input') => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span'), Button: create('button'), Input: create('input') }
})

const { taroMock } = vi.hoisted(() => {
  const mock = {
    reLaunch: vi.fn(),
    navigateTo: vi.fn(),
    navigateBack: vi.fn(),
    // 主题 Provider 依赖的系统/存储/窗口 API
    getSystemInfoSync: vi.fn(() => ({ theme: 'light' })),
    setNavigationBarColor: vi.fn(() => Promise.resolve()),
    setBackgroundColor: vi.fn(() => Promise.resolve()),
    setTabBarStyle: vi.fn(() => Promise.resolve()),
    onThemeChange: vi.fn(),
    offThemeChange: vi.fn(),
    getStorage: vi.fn(() => Promise.resolve({ data: null })),
    setStorage: vi.fn(() => Promise.resolve()),
  }
  // 默认导入（theme-context 的 import Taro from '@tarojs/taro'）与命名导入同源
  ;(mock as unknown as Record<string, unknown>).default = mock
  return { taroMock: mock }
})
vi.mock('@tarojs/taro', () => taroMock)

// 已登录用户跳转由 routeAfterLogin 承担（其行为另有单测），此处断言「委托了路由」
const { routeAfterLoginMock } = vi.hoisted(() => ({ routeAfterLoginMock: vi.fn() }))
vi.mock('@/lib/post-auth-route', () => ({ routeAfterLogin: routeAfterLoginMock }))

// 微信登录逻辑整体 mock：仅断言入口页「委托」了登录，具体桥接逻辑另有单测
const { loginWithWechatMock } = vi.hoisted(() => ({ loginWithWechatMock: vi.fn() }))
vi.mock('@/hooks/useWechatLogin', () => ({
  useWechatLogin: () => ({ submitting: false, loginWithWechat: loginWithWechatMock }),
}))

// 可变的 useUser mock
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
    signOut: vi.fn(),
  }
  return { authMock: auth, supabaseMock: { auth } }
})
vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }))

const makeUser = (id: string) => ({
  id,
  email: `${id}@example.com`,
  emailConfirmed: true,
})

/** 渲染助手：包一层 ThemeProvider（页面根节点 useThemeClass 依赖主题上下文） */
const renderPage = () =>
  render(
    <ThemeProvider>
      <LoginPage />
    </ThemeProvider>
  )

describe('LoginPage（入口）', () => {
  beforeEach(() => {
    ctx.ready = true
    ctx.user = null
    ctx.session = null
    ctx.restoreFailed = false
    authMock.getUser.mockReset()
    authMock.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    authMock.signOut.mockReset()
    authMock.signOut.mockResolvedValue({ error: null })
    authMock.getSession.mockReset()
    authMock.getSession.mockResolvedValue({
      data: { session: { user: { id: 'u1' } } },
      error: null,
    })
    taroMock.reLaunch.mockClear()
    taroMock.navigateTo.mockClear()
    routeAfterLoginMock.mockReset()
    routeAfterLoginMock.mockResolvedValue(undefined)
    loginWithWechatMock.mockReset()
    loginWithWechatMock.mockResolvedValue({ error: null })
  })

  afterEach(() => {
    cleanup()
  })

  it('渲染两个入口按钮：微信授权登录/注册 与 使用邮箱登录/注册', () => {
    renderPage()
    expect(screen.getByRole('button', { name: '微信授权登录/注册' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '使用邮箱登录/注册' })).toBeTruthy()
  })

  it('点击「使用邮箱登录/注册」路由到邮箱登录页', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '使用邮箱登录/注册' }))
    expect(taroMock.navigateTo).toHaveBeenCalledWith({ url: '/pages/email-login/index' })
  })

  it('点击「微信授权登录/注册」委托微信登录逻辑', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '微信授权登录/注册' }))
    expect(loginWithWechatMock).toHaveBeenCalled()
  })

  it('会话恢复完成前显示加载占位', () => {
    ctx.ready = false
    renderPage()
    expect(screen.getByText('加载中…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '微信授权登录/注册' })).toBeNull()
  })

  it('已登录用户访问登录页：校验会话后按 profile 状态路由入口', async () => {
    ctx.user = makeUser('u1')
    ctx.session = {} as UserContextValue['session']
    renderPage()
    expect(authMock.getUser).toHaveBeenCalled()
    await waitFor(() => expect(routeAfterLoginMock).toHaveBeenCalledWith(supabaseMock))
  })

  it('已登录但 getUser 失败（会话已吊销）：不跳转且静默登出', async () => {
    authMock.getUser.mockRejectedValue(new Error('AuthSessionMissingError'))
    ctx.user = makeUser('u1')
    ctx.session = {} as UserContextValue['session']
    renderPage()
    await waitFor(() => expect(authMock.signOut).toHaveBeenCalled())
    expect(routeAfterLoginMock).not.toHaveBeenCalled()
  })

  it('会话恢复失败时显示网络异常提示', () => {
    ctx.restoreFailed = true
    renderPage()
    expect(screen.getByText('网络异常，请重试')).toBeTruthy()
  })
})
