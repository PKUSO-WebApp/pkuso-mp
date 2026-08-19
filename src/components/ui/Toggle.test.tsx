// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Toggle } from './Toggle'

vi.mock('@tarojs/components', () => {
  const create = (tag: 'div' | 'span' | 'button') => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span'), Button: create('button') }
})

const OPTIONS = ['合排', '分排'] as const

describe('Toggle', () => {
  afterEach(cleanup)

  it('渲染所有选项', () => {
    render(<Toggle options={OPTIONS} value='合排' onChange={vi.fn()} />)
    expect(screen.getByText('合排')).toBeTruthy()
    expect(screen.getByText('分排')).toBeTruthy()
  })

  it('点击触发 onChange', () => {
    const onChange = vi.fn()
    render(<Toggle options={OPTIONS} value='合排' onChange={onChange} />)
    fireEvent.click(screen.getByText('分排'))
    expect(onChange).toHaveBeenCalledWith('分排')
  })

  it('激活项有深色样式', () => {
    render(<Toggle options={OPTIONS} value='合排' onChange={vi.fn()} />)
    const active = screen.getByText('合排')
    expect(active.className).toContain('bg-primary')
  })

  it('支持自定义标签', () => {
    const LABELS = { ensemble: '重奏', gathering: '团建' } as const
    render(
      <Toggle
        options={['ensemble', 'gathering'] as const}
        value='ensemble'
        onChange={vi.fn()}
        getLabel={(k) => LABELS[k as keyof typeof LABELS]}
      />
    )
    expect(screen.getByText('重奏')).toBeTruthy()
    expect(screen.getByText('团建')).toBeTruthy()
  })
})
