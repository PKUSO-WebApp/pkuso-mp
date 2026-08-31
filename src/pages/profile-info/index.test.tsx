// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ProfileInfoPage from './index'

const { taroMock, updateProfileMock } = vi.hoisted(() => ({
  taroMock: {
    showToast: vi.fn(),
    showModal: vi.fn(() => Promise.resolve({ confirm: true })),
    navigateTo: vi.fn(),
  },
  updateProfileMock: vi.fn(async (_id: string, _payload: any) => true),
}))

vi.mock('@tarojs/components', () => {
  const create = (tag: any) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  const Picker = (props: any) => {
    const value = props.mode === 'multiSelector' ? [0, 0] : 0
    return React.createElement(
      'div',
      { onClick: () => props.onChange?.({ detail: { value } }) },
      props.children
    )
  }
  const Input = (props: any) => React.createElement('input', props)
  const Image = (props: any) => React.createElement('img', props)
  const Button = (props: any) => React.createElement('button', props)
  return { View: create('div'), Text: create('span'), Input, Picker, Image, Button }
})

vi.mock('@tarojs/taro', () => ({ default: taroMock }))
vi.mock('@/context/theme-context', () => ({ useThemeClass: () => '' }))
vi.mock('@/context/user-context', () => ({
  useUser: () => ({ user: { id: 'u1', email: 'a@b.com' } }),
}))
vi.mock('@/hooks/useProfiles', () => ({
  useProfiles: () => ({
    data: [
      {
        id: 'u1',
        full_name: '张三',
        instrument: '长笛',
        email: 'a@b.com',
        phone_number: '13800000000',
        college: '元培学院',
        join_date: '2024秋',
        is_in_orchestra: true,
        hide_email: false,
        hide_phone: false,
        hide_join_date: false,
        hide_college: false,
        role: 'member',
      },
    ],
    loading: false,
    error: null,
    update: updateProfileMock,
  }),
}))
vi.mock('@/lib/validation', () => ({ isValidEmail: () => true, isValidPhoneNumber: () => true }))
vi.mock('@/constants/instruments', () => ({
  INSTRUMENT_ORDER: ['第一小提琴', '长笛'],
  OTHER_INSTRUMENT_GROUP: '其他',
}))
vi.mock('@/assets/icons/eye.png', () => ({ default: 'eye.png' }))
vi.mock('@/assets/icons/eye-off.png', () => ({ default: 'eye-off.png' }))
vi.mock('@/assets/icons/eye-dark.png', () => ({ default: 'eye-dark.png' }))
vi.mock('@/assets/icons/eye-off-dark.png', () => ({ default: 'eye-off-dark.png' }))
vi.mock('@/assets/icons/pencil-line.png', () => ({ default: 'pencil-line.png' }))
vi.mock('@/assets/icons/pencil-line-dark.png', () => ({ default: 'pencil-line-dark.png' }))
vi.mock('@/components/ui/ImageCropper', () => ({ ImageCropper: ({ children }: any) => React.createElement('div', { 'data-testid': 'image-cropper' }, children) }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://example.com/avatar.jpg' } }),
      }),
    },
  },
}))

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
describe('ProfileInfoPage', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('渲染乐器、学院与分隔线说明', () => {
    render(<ProfileInfoPage />)
    expect(screen.getByText('长笛')).toBeTruthy()
    expect(screen.getByText('元培学院')).toBeTruthy()
    expect(screen.getByText('以下信息可编辑隐藏')).toBeTruthy()
    // 查看态不显示头像编辑图标
    expect(document.querySelectorAll('img').length).toBe(0)
  })

  it('点击「编辑」进入编辑态，点击「保存」写入 profiles', async () => {
    render(<ProfileInfoPage />)
    fireEvent.click(screen.getByText('编辑'))
    expect(screen.getByText('取消')).toBeTruthy()
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(updateProfileMock).toHaveBeenCalled())
    const payload = updateProfileMock.mock.calls[0][1]
    expect(payload.instrument).toBe('长笛')
    expect(payload.hide_college).toBe(false)
  })

  it('编辑态点击眼图标切换隐藏状态并随保存写入', async () => {
    const { container } = render(<ProfileInfoPage />)
    fireEvent.click(screen.getByText('编辑'))
    const imgs = container.querySelectorAll('img')
    // imgs[0] 是头像编辑图标，imgs[1-3] 依次为：绑定邮箱 / 联系方式 / 学院眼图标
    fireEvent.click(imgs[1])
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(updateProfileMock).toHaveBeenCalled())
    const payload = updateProfileMock.mock.calls[0][1]
    expect(payload.hide_email).toBe(true)
  })
})

