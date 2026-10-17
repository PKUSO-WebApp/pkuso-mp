// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { RehearsalRow } from '@/types/database'
import { resetTestLocale, setTestLocale } from '@/test-utils/i18n-mock'
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
  const { createI18nMock } = await import('@/test-utils/i18n-mock')
  return createI18nMock()
})
describe('RehearsalCard', () => {
  beforeEach(() => resetTestLocale())
  afterEach(cleanup)

  it('英文环境：排练类型标签显示英文', () => {
    setTestLocale('en')
    render(<RehearsalCard item={upcomingRehearsal} />)
    expect(screen.getByText(/Full Ensemble/)).toBeTruthy()
    expect(screen.queryByText(/合排/)).toBeNull()
  })

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
