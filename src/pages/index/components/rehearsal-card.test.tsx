// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

const rehearsal = {
  id: 1,
  type: 'full',
  repertoire: '贝多芬第五交响曲',
  start_time: '2099-01-01T10:00:00',
  end_time: '2099-01-01T12:00:00',
  location: '排练厅',
  sign_in_code: '1234',
} as unknown as RehearsalRow

describe('RehearsalCard', () => {
  afterEach(cleanup)

  it('点击整卡触发 onClick', () => {
    const onClick = vi.fn()
    render(<RehearsalCard item={rehearsal} attendanceLoading={false} onClick={onClick} />)
    fireEvent.click(screen.getByText('贝多芬第五交响曲').closest('button')!)
    expect(onClick).toHaveBeenCalled()
  })

  it('未传 onClick 时渲染 View（div），点击无副作用', () => {
    const { container } = render(<RehearsalCard item={rehearsal} attendanceLoading={false} />)
    // Card 无 onClick → View 形态
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('div')).toBeTruthy()
  })
})
