// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ForceOfflineModal } from './force-offline-modal'

vi.mock('@tarojs/components', () => {
  const create = (tag: string) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return {
    View: create('div'),
    Text: create('span'),
    Button: create('button'),
    RootPortal: ({ children }: any) => React.createElement(React.Fragment, null, children),
  }
})

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ opened, children }: any) =>
    opened ? React.createElement('div', { 'data-testid': 'modal' }, children) : null,
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
describe('ForceOfflineModal', () => {
  afterEach(() => cleanup())

  it('opened=false 时不渲染', () => {
    render(<ForceOfflineModal opened={false} at={null} onClose={() => {}} />)
    expect(screen.queryByText(/另一设备于/)).toBeNull()
  })

  it('渲染强制下线文案且含另一设备登录时刻', () => {
    render(<ForceOfflineModal opened at='2026-08-22T11:00:00Z' onClose={() => {}} />)
    expect(screen.getByText(/另一设备于/)).toBeTruthy()
    expect(screen.getByText(/登录你的账号，当前设备已经下线/)).toBeTruthy()
    expect(screen.getByText(/请尽快重新登录并修改密码/)).toBeTruthy()
  })

  it('点击按钮触发 onClose', () => {
    const onClose = vi.fn()
    render(<ForceOfflineModal opened at='2026-08-22T11:00:00Z' onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '重新登录' }))
    expect(onClose).toHaveBeenCalled()
  })
})

