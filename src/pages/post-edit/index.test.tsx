// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PostRowWithAuthor } from '@/types/database'
import { resetTestLocale, setTestLocale } from '@/test-utils/i18n-mock'
import PostEdit from './index'

const SAMPLE: PostRowWithAuthor[] = [
  {
    id: 'a',
    title: '我的重奏',
    type: 'ensemble',
    content: '来排练',
    current_sections: '小提琴',
    missing_sections: '中提',
    contact_info: 'wx123',
    image_url: null,
    is_locked: false,
    locked_by: null,
    created_at: '2026-01-01T00:00:00',
    author_id: 'u1',
  },
]

const mocks = vi.hoisted(() => ({
  fetchOne: vi.fn(async (id: string) => SAMPLE.find((p) => p.id === id) || null),
  updatePost: vi.fn(async (_id: string, _input: any) => ({ ok: true })),
  taro: {
    navigateBack: vi.fn(),
    showToast: vi.fn(),
    chooseMedia: vi.fn(),
  },
}))

vi.mock('@tarojs/components', () => {
  const create = (tag: any) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  const Image = (props: any) => React.createElement('img', props)
  return {
    View: create('div'),
    ScrollView: create('div'),
    Text: create('span'),
    Button: create('button'),
    Image,
    Input: (props: any) =>
      React.createElement('input', {
        ...props,
        onChange: (e: any) => props.onInput?.({ detail: { value: e?.target?.value } }),
        onInput: (e: any) => props.onInput?.({ detail: { value: e?.target?.value } }),
      }),
    Textarea: (props: any) => React.createElement('textarea', props),
  }
})

vi.mock('@tarojs/taro', () => ({
  default: {
    getCurrentInstance: () => ({ router: { params: { id: 'a' } } }),
    navigateBack: mocks.taro.navigateBack,
    showToast: mocks.taro.showToast,
    chooseMedia: mocks.taro.chooseMedia,
  },
  useDidShow: (fn: () => void) => {
    // 在测试中直接调用 fn 以触发效果
    const callback = React.useCallback(fn, [fn])
    React.useEffect(() => {
      callback()
    }, [callback])
  },
}))

vi.mock('@/context/theme-context', () => ({ useThemeClass: () => '' }))
vi.mock('@/hooks/usePosts', () => ({
  usePosts: () => ({
    fetchOne: mocks.fetchOne,
    updatePost: mocks.updatePost,
    saving: false,
  }),
}))

vi.mock('@/i18n', async () => {
  const { createI18nMock } = await import('@/test-utils/i18n-mock')
  return createI18nMock()
})
describe('编辑活动页', () => {
  beforeEach(() => resetTestLocale())
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('英文环境：占位符与保存按钮显示英文', async () => {
    setTestLocale('en')
    render(<PostEdit />)
    await screen.findByDisplayValue('我的重奏')
    expect(screen.getByPlaceholderText('Enter a title')).toBeTruthy()
    expect(screen.getByText('Save')).toBeTruthy()
    expect(screen.getByText('Cancel')).toBeTruthy()
  })

  it('加载并预填帖子数据', async () => {
    render(<PostEdit />)
    expect(await screen.findByDisplayValue('我的重奏')).toBeTruthy()
    expect(screen.getByDisplayValue('来排练')).toBeTruthy()
    expect(screen.getByDisplayValue('小提琴')).toBeTruthy()
    expect(screen.getByDisplayValue('中提')).toBeTruthy()
    expect(screen.getByDisplayValue('wx123')).toBeTruthy()
  })

  it('点击保存调用 updatePost（重奏含声部，图片保留原图）', async () => {
    render(<PostEdit />)
    await screen.findByDisplayValue('我的重奏')
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(mocks.updatePost).toHaveBeenCalled())
    const payload = mocks.updatePost.mock.calls[0][1] as any
    expect(payload.title).toBe('我的重奏')
    expect(payload.current_sections).toBe('小提琴')
    expect(payload.missing_sections).toBe('中提')
    expect(payload.imageFile).toBeUndefined()
  })

  it('未填标题时保存被拦截', async () => {
    render(<PostEdit />)
    await screen.findByDisplayValue('我的重奏')
    const titleInput = screen.getByDisplayValue('我的重奏')
    fireEvent.change(titleInput, { target: { value: '  ' } })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(screen.getByText('请填写标题')).toBeTruthy())
    expect(mocks.updatePost).not.toHaveBeenCalled()
  })
})
