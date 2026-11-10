// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CountBadge } from './CountBadge'

vi.mock('@tarojs/components', () => {
  const create = (tag: any) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span') }
})

describe('CountBadge', () => {
  afterEach(cleanup)

  it('沿用「我的」页未读徽章的布局类名（不是 inline-flex / 小号）', () => {
    render(<CountBadge count={1} />)
    const badge = screen.getByText('1').parentElement!
    for (const cls of [
      'flex',
      'h-5',
      'min-w-5',
      'items-center',
      'justify-center',
      'rounded-full',
      'bg-danger',
      'px-1.5',
    ]) {
      expect(badge.className).toContain(cls)
    }
    expect(badge.className).not.toContain('inline-flex')
    expect(screen.getByText('1').className).toContain('text-xs')
  })

  it('0 不渲染', () => {
    const { container } = render(<CountBadge count={0} />)
    expect(container.innerHTML).toBe('')
  })

  it('超过 99 显示 99+', () => {
    render(<CountBadge count={100} />)
    expect(screen.getByText('99+')).toBeTruthy()
  })
})
