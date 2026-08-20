// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { EntryProfile } from '@/lib/profile-gate'
import SetupPage from './index'

// @tarojs/components mock：Input 需把 DOM input 事件桥接成 Taro 的 { detail: { value } }
vi.mock('@tarojs/components', () => {
  const create = (tag: 'div' | 'span' | 'button') => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  const Input = (props: any) => {
    const { onInput, ...rest } = props
    return React.createElement('input', {
      ...rest,
      onInput: (e: any) => onInput?.({ detail: { value: e.target.value } }),
    })
  }
  return { View: create('div'), Text: create('span'), Button: create('button'), Input }
})

const { taroMock } = vi.hoisted(() => {
  const mock = { reLaunch: vi.fn(), showToast: vi.fn() }
  ;(mock as unknown as Record<string, unknown>).default = mock
  return { taroMock: mock }
})
vi.mock('@tarojs/taro', () => taroMock)

const { userCtx } = vi.hoisted(() => ({
  userCtx: { user: { id: 'u1' } as { id: string } | null, ready: true },
}))
vi.mock('@/context/user-context', () => ({ useUser: () => userCtx }))
vi.mock('@/context/theme-context', () => ({ useThemeClass: () => '' }))
vi.mock('@/hooks/useLogout', () => ({
  useLogout: () => ({ signingOut: false, logout: logoutMock }),
}))

const { logoutMock, routeAfterLoginMock, updateSelectMock, updateMock, eqMock, supabaseFromMock } =
  vi.hoisted(() => {
    const updateSelect = vi.fn()
    const eq = vi.fn(() => ({ select: updateSelect }))
    const update = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ update }))
    return {
      logoutMock: vi.fn(),
      routeAfterLoginMock: vi.fn(),
      updateSelectMock: updateSelect,
      updateMock: update,
      eqMock: eq,
      supabaseFromMock: from,
    }
  })
vi.mock('@/lib/post-auth-route', () => ({ routeAfterLogin: routeAfterLoginMock }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: supabaseFromMock } }))

// 预填来源（可变）
const profileCtx = { profile: null as EntryProfile | null }

// 注：useProfileStatus mock 返回 profile: profileCtx.profile（可变值，非包装对象）
vi.mock('@/hooks/useProfileStatus', () => ({
  useProfileStatus: () => ({
    profile: profileCtx.profile,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

/** 在页面内输入姓名与邮箱 */
const fillForm = (name: string, email: string) => {
  fireEvent.input(screen.getByPlaceholderText('请输入真实姓名'), { target: { value: name } })
  fireEvent.input(screen.getByPlaceholderText('name@example.com'), { target: { value: email } })
}

describe('SetupPage', () => {
  beforeEach(() => {
    userCtx.user = { id: 'u1' }
    userCtx.ready = true
    profileCtx.profile = null
    taroMock.reLaunch.mockClear()
    taroMock.showToast.mockClear()
    logoutMock.mockReset()
    routeAfterLoginMock.mockReset()
    routeAfterLoginMock.mockResolvedValue(undefined)
    updateSelectMock.mockReset()
    updateSelectMock.mockResolvedValue({ data: [{ id: 'u1' }], error: null })
    updateMock.mockClear()
    eqMock.mockClear()
    supabaseFromMock.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('姓名与邮箱均必填：缺姓名提示且不提交', async () => {
    render(<SetupPage />)
    fillForm('', 'zhangsan@example.com')
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    expect(await screen.findByText('请输入姓名')).toBeTruthy()
    expect(supabaseFromMock).not.toHaveBeenCalled()
    expect(routeAfterLoginMock).not.toHaveBeenCalled()
  })

  it('邮箱格式非法：提示且不提交', async () => {
    render(<SetupPage />)
    fillForm('张三', 'not-an-email')
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    expect(await screen.findByText('请输入有效的邮箱地址')).toBeTruthy()
    expect(supabaseFromMock).not.toHaveBeenCalled()
  })

  it('姓名超长：提示且不提交', async () => {
    render(<SetupPage />)
    fillForm('张'.repeat(31), 'zhangsan@example.com')
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    expect(await screen.findByText('姓名过长（最多 30 字）')).toBeTruthy()
    expect(supabaseFromMock).not.toHaveBeenCalled()
  })

  it('提交成功：trim 后更新 profiles + toast + 重新走入口路由', async () => {
    render(<SetupPage />)
    fillForm(' 张三 ', 'zhangsan@example.com')
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith({ full_name: '张三', email: 'zhangsan@example.com' })
    )
    expect(eqMock).toHaveBeenCalledWith('id', 'u1')
    await waitFor(() => expect(taroMock.showToast).toHaveBeenCalled())
    expect(taroMock.showToast).toHaveBeenCalledWith({
      title: '资料已提交，等待管理员审核',
      icon: 'none',
    })
    expect(routeAfterLoginMock).toHaveBeenCalled()
  })

  it('0 行更新（RLS 静默失败/记录不存在）：提示保存失败且不路由', async () => {
    updateSelectMock.mockResolvedValue({ data: [], error: null })
    render(<SetupPage />)
    fillForm('张三', 'zhangsan@example.com')
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    expect(await screen.findByText('保存失败，请重试')).toBeTruthy()
    expect(routeAfterLoginMock).not.toHaveBeenCalled()
  })

  it('更新出错：提示保存失败且不路由', async () => {
    updateSelectMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    render(<SetupPage />)
    fillForm('张三', 'zhangsan@example.com')
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    expect(await screen.findByText('保存失败，请重试')).toBeTruthy()
    expect(routeAfterLoginMock).not.toHaveBeenCalled()
  })

  it('取消：登出（回到登录页）', () => {
    render(<SetupPage />)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(logoutMock).toHaveBeenCalled()
  })

  it('未登录：回登录页', async () => {
    userCtx.user = null
    render(<SetupPage />)
    await waitFor(() =>
      expect(taroMock.reLaunch).toHaveBeenCalledWith({ url: '/pages/login/index' })
    )
  })

  it('预填：真实邮箱带入、合成邮箱视为未填写', () => {
    profileCtx.profile = { full_name: '', email: 'wechat_abc@placeholder.local', status: 'pending' }
    render(<SetupPage />)
    expect((screen.getByPlaceholderText('name@example.com') as HTMLInputElement).value).toBe('')
    profileCtx.profile = {
      full_name: '张三',
      email: 'zhangsan@example.com',
      status: 'pending',
    }
    cleanup()
    render(<SetupPage />)
    expect((screen.getByPlaceholderText('请输入真实姓名') as HTMLInputElement).value).toBe('张三')
    expect((screen.getByPlaceholderText('name@example.com') as HTMLInputElement).value).toBe(
      'zhangsan@example.com'
    )
  })
})
