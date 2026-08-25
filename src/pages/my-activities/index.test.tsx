// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PostRowWithAuthor } from '@/types/database'
import MyActivities from './index'

const mocks = vi.hoisted(() => ({
  fetchMine: vi.fn(),
  setLocked: vi.fn(async () => ({ ok: true })),
  deletePost: vi.fn(async () => ({ ok: true })),
  taro: {
    navigateTo: vi.fn(),
    showToast: vi.fn(),
    useDidShow: vi.fn(),
  },
}))

const SAMPLE: PostRowWithAuthor[] = [
  {
    id: 'a',
    title: '我的重奏',
    type: 'ensemble',
    content: 'c',
    current_sections: '小提琴',
    missing_sections: '中提',
    contact_info: 'wx123',
    image_url: null,
    is_locked: false,
    created_at: '2026-01-01T00:00:00',
    author_id: 'u1',
  },
  {
    id: 'b',
    title: '我的团建',
    type: 'gathering',
    content: 'c2',
    current_sections: null,
    missing_sections: null,
    contact_info: '',
    image_url: null,
    is_locked: false,
    created_at: '2026-01-02T00:00:00',
    author_id: 'u1',
  },
]

vi.mock('@tarojs/components', () => {
  const create = (tag: any) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  const Image = (props: any) => React.createElement('img', props)
  return { View: create('div'), Text: create('span'), Button: create('button'), Image }
})

vi.mock('@tarojs/taro', () => ({ default: mocks.taro, useDidShow: mocks.taro.useDidShow }))

vi.mock('@/context/theme-context', () => ({ useThemeClass: () => '' }))
vi.mock('@/hooks/useMyProfile', () => ({ useMyProfile: () => ({ profile: { role: 'member' } }) }))
vi.mock('@/components/page-header', () => ({
  PageHeader: ({ title }: any) => React.createElement('div', null, title),
}))
vi.mock('@/components/ui/Card', () => ({
  Card: ({ children, onClick }: any) => React.createElement('div', { onClick }, children),
}))
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, children }: any) => (open ? React.createElement('div', null, children) : null),
}))

vi.mock('@/hooks/usePosts', () => ({
  usePosts: () => ({
    mine: SAMPLE,
    mineLoading: false,
    mineError: null,
    fetchMine: mocks.fetchMine,
    setLocked: mocks.setLocked,
    deletePost: mocks.deletePost,
  }),
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
describe('我的活动管理页', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('渲染我发布的活动，并展示声部与联系方式（团建联系方式为空显示「无」）', () => {
    render(<MyActivities />)
    expect(screen.getByText('我的重奏')).toBeTruthy()
    expect(screen.getByText('我的团建')).toBeTruthy()
    expect(screen.getByText('已有声部：小提琴')).toBeTruthy()
    expect(screen.getByText('需要声部：中提')).toBeTruthy()
    expect(screen.getByText('联系方式：wx123')).toBeTruthy()
    expect(screen.getByText('联系方式：无')).toBeTruthy()
  })

  it('点击 ··· 打开菜单，锁定调用 setLocked(true)', () => {
    render(<MyActivities />)
    fireEvent.click(screen.getAllByText('···')[0])
    fireEvent.click(screen.getByText('锁定'))
    expect(mocks.setLocked).toHaveBeenCalledWith('a', true)
  })

  it('点击编辑 › 跳转到编辑页', () => {
    render(<MyActivities />)
    fireEvent.click(screen.getAllByText('编辑 ›')[0])
    expect(mocks.taro.navigateTo).toHaveBeenCalledWith({ url: '/pages/post-edit/index?id=a' })
  })

  it('删除需二次确认，确认后调用 deletePost', () => {
    render(<MyActivities />)
    fireEvent.click(screen.getAllByText('···')[1])
    fireEvent.click(screen.getByText('删除'))
    expect(screen.getByText('删除后不可恢复，确定删除该活动？')).toBeTruthy()
    fireEvent.click(screen.getByText('删除'))
    expect(mocks.deletePost).toHaveBeenCalledWith('b')
  })
})

