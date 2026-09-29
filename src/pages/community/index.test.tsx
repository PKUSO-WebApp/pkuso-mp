// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import type { PostRowWithAuthor } from '@/types/database'
import Community from './index'

vi.mock('@tarojs/components', () => {
  const create = (tag: 'div' | 'span' | 'button') => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  const Image = (props: any) => React.createElement('img', props)
  return { View: create('div'), Text: create('span'), Button: create('button'), Image }
})

vi.mock('@tarojs/taro', () => ({
  default: {
    showToast: vi.fn(),
    navigateTo: vi.fn(),
    switchTab: vi.fn(),
    showModal: vi.fn(),
  },
  useDidShow: vi.fn(),
}))

vi.mock('@/hooks/usePosts', () => ({
  usePosts: () => ({
    data: [
      {
        id: '1',
        title: '重奏A',
        type: 'ensemble',
        content: '内容A',
        missing_sections: '双簧管',
        created_at: '2026-08-20T10:00:00',
        profiles: { full_name: '张三' },
      },
      {
        id: '2',
        title: '团建B',
        type: 'gathering',
        content: '内容B',
        created_at: '2026-08-21T10:00:00',
        profiles: { full_name: '李四' },
      },
    ] as PostRowWithAuthor[],
    loading: false,
    error: null,
    fetch: vi.fn(),
  }),
}))

vi.mock('@/hooks/useMyProfile', () => ({
  useMyProfile: () => ({ profile: { role: 'member' } }),
}))

vi.mock('@/context/user-context', () => ({
  useUser: () => ({ user: { id: 'test-user-id' } }),
}))

vi.mock('@/context/theme-context', () => ({
  useThemeClass: () => '',
}))

vi.mock('@/components/staff-blocked-page', () => ({
  StaffBlockedPage: () => null,
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
  return {
    useT: () => ({
      t: (k: string, p?: Record<string, unknown>) => get(k, p),
      locale: 'zh-CN',
      setLocale: vi.fn(),
    }),
    useNavTitle: vi.fn(),
  }
})
describe('Community 公告页（只读）', () => {
  afterEach(() => {
    cleanup()
  })

  it('默认显示重奏，切换分类正确过滤', () => {
    render(<Community />)
    // 删页头后仅保留 Toggle 与右下角发布悬浮按钮
    expect(screen.getByText('发布')).toBeTruthy()
    // 默认重奏：重奏A 可见，团建B 隐藏
    expect(screen.getByText('重奏A')).toBeTruthy()
    expect(screen.queryByText('团建B')).toBeNull()
    // 切到团建：重奏A 隐藏，团建B 显示
    fireEvent.click(screen.getByText('团建'))
    expect(screen.queryByText('重奏A')).toBeNull()
    expect(screen.getByText('团建B')).toBeTruthy()
    // 切回重奏：重奏A 显示，团建B 隐藏
    fireEvent.click(screen.getByText('重奏'))
    expect(screen.getByText('重奏A')).toBeTruthy()
    expect(screen.queryByText('团建B')).toBeNull()
  })

  it('点击卡片跳转到公告详情页', () => {
    render(<Community />)
    fireEvent.click(screen.getByText('重奏A'))
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/pages/post-detail/index?id=1' })
  })
})
