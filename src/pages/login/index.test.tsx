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
  return {
    View: create('div'),
    Text: create('span'),
    Button: create('button'),
    Input: create('input'),
  }
})

const { taroMock } = vi.hoisted(() => {
  const mock = {
    reLaunch: vi.fn(),
    navigateTo: vi.fn(),
    navigateBack: vi.fn(),
    getCurrentInstance: vi.fn(() => ({ router: { path: '/pages/login/index', params: {} } })),
    // 主题 Provider 依赖的系统/存储/窗口 API
    getSystemInfoSync: vi.fn(() => ({ theme: 'light' })),
    setNavigationBarColor: vi.fn(() => Promise.resolve()),
    setBackgroundColor: vi.fn(() => Promise.resolve()),
    setTabBarStyle: vi.fn(() => Promise.resolve()),
    onThemeChange: vi.fn(),
    offThemeChange: vi.fn(),
    getStorage: vi.fn(() => Promise.resolve({ data: null })),
    setStorage: vi.fn(() => Promise.resolve()),
    showToast: vi.fn(),
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

// useSendLoginCode mock
const { sendCodeMock } = vi.hoisted(() => ({
  sendCodeMock: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/hooks/useSendLoginCode', () => ({
  useSendLoginCode: () => ({
    sending: false,
    countdown: 60,
    isCountingDown: false,
    sendCode: sendCodeMock,
  }),
}))

// 可变的 useUser mock
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
    signInWithPassword: vi.fn(),
    setSession: vi.fn(),
  }
  const fromMock = vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'u1' } }),
  }))
  const functionsInvokeMock = vi.fn().mockResolvedValue({
    data: { access_token: 'at', refresh_token: 'rt' },
    error: null,
  })
  return {
    authMock: auth,
    supabaseMock: {
      auth,
      from: fromMock,
      functions: { invoke: functionsInvokeMock },
    },
  }
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

describe('LoginPage', () => {
  beforeEach(() => {
    ctx.ready = true
    ctx.user = null
    ctx.session = null
    ctx.restoreFailed = false
    ctx.forcedOffline = false
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
    taroMock.showToast.mockClear()
    routeAfterLoginMock.mockReset()
    routeAfterLoginMock.mockResolvedValue(undefined)
    loginWithWechatMock.mockReset()
    loginWithWechatMock.mockResolvedValue({ error: null })
    sendCodeMock.mockReset()
    sendCodeMock.mockResolvedValue({ success: true })
    supabaseMock.auth.signInWithPassword.mockReset()
    supabaseMock.auth.setSession.mockReset()
    supabaseMock.auth.setSession.mockResolvedValue({ error: null })
    supabaseMock.from.mockReset()
    supabaseMock.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'u1' } }),
    })
    supabaseMock.functions.invoke.mockReset()
    supabaseMock.functions.invoke.mockResolvedValue({
      data: { access_token: 'at', refresh_token: 'rt' },
      error: null,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('渲染微信登录按钮和邮箱表单', () => {
    renderPage()
    expect(screen.getByRole('button', { name: '微信授权登录' })).toBeTruthy()
    expect(screen.getByPlaceholderText('name@example.com')).toBeTruthy()
    expect(screen.getByRole('button', { name: '登录' })).toBeTruthy()
  })

  it('点击微信登录按钮委托微信登录逻辑', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '微信授权登录' }))
    expect(loginWithWechatMock).toHaveBeenCalled()
  })

  it('切换到密码登录模式', () => {
    renderPage()
    // 初始为验证码模式，显示获取验证码按钮
    expect(screen.getByText('获取验证码')).toBeTruthy()
    // 点击切换
    fireEvent.click(screen.getByText('用密码登录'))
    // 密码模式下不应显示验证码按钮
    expect(screen.queryByText('获取验证码')).toBeNull()
  })

  it('会话恢复完成前显示加载占位', () => {
    ctx.ready = false
    renderPage()
    expect(screen.getByText(/加载中/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '微信授权登录' })).toBeNull()
  })

  it('已登录用户访问登录页：校验会话后按 profile 状态路由', async () => {
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

  it('强制离线时显示 ForceOfflineModal', () => {
    ctx.forcedOffline = true
    renderPage()
    expect(screen.getByText('账号已在其他设备登录')).toBeTruthy()
  })
})
