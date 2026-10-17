// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import type { PostRowWithAuthor } from '@/types/database'
import { resetTestLocale, setTestLocale } from '@/test-utils/i18n-mock'
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
  const { createI18nMock } = await import('@/test-utils/i18n-mock')
  return createI18nMock()
})
describe('Community 公告页（只读）', () => {
  beforeEach(() => resetTestLocale())
  afterEach(() => {
    cleanup()
  })

  it('英文环境：发布按钮与分类标签显示英文', () => {
    setTestLocale('en')
    render(<Community />)
    expect(screen.getByText('Post')).toBeTruthy()
    expect(screen.getByText('Ensemble')).toBeTruthy()
    fireEvent.click(screen.getByText('Activity'))
    expect(screen.getByText('团建B')).toBeTruthy()
    expect(screen.queryByText('重奏A')).toBeNull()
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
