// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { RehearsalRow } from '@/types/database'
import { RehearsalCard } from './rehearsal-card'

vi.mock('@tarojs/components', () => {
  const create = (tag: string) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span'), Button: create('button') }
})

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

const upcomingRehearsal = {
  id: 1,
  type: 'full',
  repertoire: '贝多芬第五交响曲',
  start_time: '2099-01-01T10:00:00',
  end_time: '2099-01-01T12:00:00',
  location: '排练厅',
  checkin_lat: null,
  checkin_lng: null,
  checkin_radius_m: null,
  sign_in_code: '1234',
} as unknown as RehearsalRow

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
describe('RehearsalCard', () => {
  afterEach(cleanup)

  it('点击整卡触发 onClick', () => {
    const onClick = vi.fn()
    const { container } = render(<RehearsalCard item={upcomingRehearsal} onClick={onClick} />)
    fireEvent.click(container.firstElementChild!)
    expect(onClick).toHaveBeenCalled()
  })

  it('未传 onClick 时点击无副作用', () => {
    const { container } = render(<RehearsalCard item={upcomingRehearsal} />)
    fireEvent.click(container.firstElementChild!)
    expect(container.firstElementChild).toBeTruthy()
  })

  it('未查看时右上角渲染红色气泡，已查看时不渲染', () => {
    const { container, rerender } = render(<RehearsalCard item={upcomingRehearsal} seen={false} />)
    // Card 内：信息行 + 红气泡 = 两个子节点
    expect(container.firstElementChild!.children.length).toBe(2)
    rerender(<RehearsalCard item={upcomingRehearsal} seen />)
    expect(container.firstElementChild!.children.length).toBe(1)
  })
})
