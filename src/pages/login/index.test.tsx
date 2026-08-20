// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { UserContextValue } from '@/context/user-context'
import { ThemeProvider } from '@/context/theme-context'
import LoginPage from './index'

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
  const taroMock = {
    reLaunch: vi.fn(),
    // 主题 Provider 依赖的系统/存储 API
    getSystemInfoSync: vi.fn(() => ({ theme: 'light' })),
    setNavigationBarColor: vi.fn(),
    onThemeChange: vi.fn(),
    offThemeChange: vi.fn(),
    getStorage: vi.fn(() => Promise.resolve({ data: null })),
    setStorage: vi.fn(() => Promise.resolve()),
  }
  // 默认导入（theme-context 的 import Taro from '@tarojs/taro'）与命名导入同源
  ;(taroMock as unknown as Record<string, unknown>).default = taroMock
  return { taroMock }
})
vi.mock('@tarojs/taro', () => taroMock)

// 可变的 useUser mock
const { ctx } = vi.hoisted(() => {
  const state: UserContextValue = { session: null, user: null, ready: true, restoreFailed: false }
  return { ctx: state }
})
vi.mock('@/context/user-context', () => ({ useUser: () => ctx }))

const { authMock } = vi.hoisted(() => ({
  authMock: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    getUser: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
  },
}))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: authMock } }))

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

describe('LoginPage', () => {
  beforeEach(() => {
    ctx.ready = true
    ctx.user = null
    ctx.session = null
    ctx.restoreFailed = false
    authMock.getUser.mockReset()
    authMock.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    authMock.signOut.mockReset()
    authMock.signOut.mockResolvedValue({ error: null })
    authMock.signInWithPassword.mockReset()
    authMock.signInWithPassword.mockResolvedValue({ data: { session: null }, error: null })
    taroMock.reLaunch.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('渲染邮箱密码表单与登录按钮', () => {
    renderPage()
    expect(screen.getByPlaceholderText('name@example.com')).toBeTruthy()
    expect(screen.getByPlaceholderText('请输入密码')).toBeTruthy()
    // 标题与按钮均含「登录」，分别断言
    expect(screen.getAllByText('登录')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '登录' })).toBeTruthy()
  })

  it('会话恢复完成前显示加载占位', () => {
    ctx.ready = false
    renderPage()
    expect(screen.getByText('加载中…')).toBeTruthy()
    expect(screen.queryByPlaceholderText('name@example.com')).toBeNull()
  })

  it('已登录用户访问登录页 reLaunch 到首页 tab', async () => {
    ctx.user = makeUser('u1')
    // 页面只消费 user，session 仅作上下文形态占位
    ctx.session = {} as UserContextValue['session']
    renderPage()
    // 先经 getUser 校验会话真实性，成功后跳转
    expect(authMock.getUser).toHaveBeenCalled()
    await waitFor(() =>
      expect(taroMock.reLaunch).toHaveBeenCalledWith({ url: '/pages/index/index' })
    )
  })

  it('已登录但 getUser 失败（会话已吊销）：不跳转且静默登出', async () => {
    authMock.getUser.mockRejectedValue(new Error('AuthSessionMissingError'))
    ctx.user = makeUser('u1')
    ctx.session = {} as UserContextValue['session']
    renderPage()
    await waitFor(() => expect(authMock.signOut).toHaveBeenCalled())
    expect(taroMock.reLaunch).not.toHaveBeenCalled()
  })

  it('会话恢复失败时显示网络异常提示', () => {
    ctx.restoreFailed = true
    renderPage()
    expect(screen.getByText('网络异常，请重试')).toBeTruthy()
  })

  it('未登录不触发 reLaunch', () => {
    renderPage()
    expect(taroMock.reLaunch).not.toHaveBeenCalled()
  })

  it('提交路径冒烟：输入邮箱密码并点击登录，调用 signInWithPassword 后 reLaunch', async () => {
    renderPage()
    fireEvent.input(screen.getByPlaceholderText('name@example.com'), {
      target: { value: 'test@example.com' },
    })
    fireEvent.input(screen.getByPlaceholderText('请输入密码'), {
      target: { value: 'password123' },
    })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() =>
      expect(authMock.signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      })
    )
    await waitFor(() =>
      expect(taroMock.reLaunch).toHaveBeenCalledWith({ url: '/pages/index/index' })
    )
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
    fireEvent.input(screen.getByPlaceholderText('请输入密码'), {
      target: { value: 'wrong' },
    })
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
