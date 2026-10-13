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
  return { View: create('div'), Text: create('span'), Button: create('button') }
})

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

// 多设备模型下这条通知有两种原因（kind），共用同一个弹窗、两套文案：
// - rejected：本设备被设为「不信任」（在线被踢 / 登录与冷启动被拒绝）；
// - deleted ：本设备被「删除设备」—— 同样下线，但下次登录会被当作新设备。
// 「另一设备于 X 登录了你的账号」那套文案随顶号模型一起退场，别再断言它。
describe('ForceOfflineModal', () => {
  afterEach(() => cleanup())

  it('opened=false 时不渲染', () => {
    render(<ForceOfflineModal opened={false} onClose={() => {}} />)
    expect(screen.queryByText(/该设备已被拒绝登录/)).toBeNull()
  })

  it('渲染「被拒绝登录」文案与查看入口提示', () => {
    render(<ForceOfflineModal opened onClose={() => {}} />)
    expect(screen.getByText('该设备已被拒绝登录')).toBeTruthy()
    expect(screen.getByText(/已被设为「不信任」，已下线/)).toBeTruthy()
    expect(screen.getByText(/「我的 - 登录设备」/)).toBeTruthy()
  })

  it('kind=deleted：换一套文案（已从账号中移除 / 下次登录当新设备），不能说成「被拒绝登录」', () => {
    render(<ForceOfflineModal opened kind='deleted' onClose={() => {}} />)
    expect(screen.getByText('该设备已从账号中移除')).toBeTruthy()
    expect(screen.getByText(/已被从你的账号中移除，并已下线/)).toBeTruthy()
    expect(screen.getByText(/会被当作新设备/)).toBeTruthy()
    expect(screen.queryByText('该设备已被拒绝登录')).toBeNull()
  })

  it('kind 缺失或为 null（老调用方 / 尚未判定）一律按「被拒绝登录」出文案', () => {
    const { unmount } = render(<ForceOfflineModal opened onClose={() => {}} />)
    expect(screen.getByText('该设备已被拒绝登录')).toBeTruthy()
    unmount()

    render(<ForceOfflineModal opened kind={null} onClose={() => {}} />)
    expect(screen.getByText('该设备已被拒绝登录')).toBeTruthy()
    expect(screen.queryByText('该设备已从账号中移除')).toBeNull()
  })

  it('点击按钮触发 onClose', () => {
    const onClose = vi.fn()
    render(<ForceOfflineModal opened onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '好的' }))
    expect(onClose).toHaveBeenCalled()
  })
})
