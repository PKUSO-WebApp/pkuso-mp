// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Modal } from './Modal'

vi.mock('@tarojs/components', () => {
  const create = (tag: 'div' | 'span' | 'button') => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return {
    View: create('div'),
    Text: create('span'),
    Button: create('button'),
    ScrollView: create('div'),
  }
})

// Modal 不再调用原生 tabBar API（custom tabBar 由 webview 渲染、位于 Modal 之下）；
// 此处仍 stub 掉 Taro，避免测试环境无 Taro 运行时时引入真实 runtime。
vi.mock('@tarojs/taro', () => ({
  default: {
    hideTabBar: vi.fn(() => Promise.resolve()),
    showTabBar: vi.fn(() => Promise.resolve()),
  },
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
describe('Modal', () => {
  afterEach(cleanup)

  it('open=false 隐藏内容', () => {
    const { container } = render(
      <Modal open={false} onClose={vi.fn()}>
        <span>内容</span>
      </Modal>
    )
    expect(screen.getByText('内容')).toBeTruthy()
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    expect(dialog?.getAttribute('style')).toContain('display: none')
  })

  it('open=true 渲染内容', () => {
    render(
      <Modal open onClose={vi.fn()}>
        <span>内容</span>
      </Modal>
    )
    expect(screen.getByText('内容')).toBeTruthy()
  })

  it('点击遮罩触发 onClose', () => {
    const onClose = vi.fn()
    render(<Modal open onClose={onClose} />)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalled()
  })

  it('点击面板内容不触发 onClose（事件不冒泡到遮罩）', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose}>
        <span>内容</span>
      </Modal>
    )
    fireEvent.click(screen.getByText('内容'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closeOnOverlay=false 点击遮罩不触发 onClose', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} closeOnOverlay={false}>
        <span>内容</span>
      </Modal>
    )
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('有 title 时渲染标题栏', () => {
    render(
      <Modal open onClose={vi.fn()} title='排练考勤'>
        <span>内容</span>
      </Modal>
    )
    expect(screen.getByText('排练考勤')).toBeTruthy()
  })

  it('headerExtra 渲染在标题与「关闭」按钮之间', () => {
    render(
      <Modal open onClose={vi.fn()} title='请假申请' headerExtra={<span>待审批</span>}>
        <span>内容</span>
      </Modal>
    )
    const title = screen.getByText('请假申请')
    const extra = screen.getByText('待审批')
    const close = screen.getByRole('button', { name: '关闭' })
    expect(title.compareDocumentPosition(extra) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(extra.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('position=center 渲染居中样式', () => {
    const { container } = render(
      <Modal open onClose={vi.fn()} position='center'>
        <span>居中</span>
      </Modal>
    )
    expect(container.querySelector('.items-center')).toBeTruthy()
  })
})
