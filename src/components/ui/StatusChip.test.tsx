// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { StatusChip } from './StatusChip'

vi.mock('@tarojs/components', () => {
  const create = (tag: 'div' | 'span' | 'button') => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span'), Button: create('button') }
})

describe('StatusChip', () => {
  afterEach(cleanup)

  it('渲染 children 文案', () => {
    render(<StatusChip tone='warning'>待审批</StatusChip>)
    expect(screen.getByText('待审批')).toBeTruthy()
  })

  it('warning tone 应用 bg-warning-bg text-warning', () => {
    const { container } = render(<StatusChip tone='warning'>x</StatusChip>)
    const cls = container.firstElementChild!.className
    expect(cls).toContain('bg-warning-bg')
    expect(cls).toContain('text-warning')
  })

  it('success/danger/neutral tone 应用对应 token', () => {
    const s = render(<StatusChip tone='success'>ok</StatusChip>)
    expect(s.container.firstElementChild!.className).toContain('bg-success-bg')
    const d = render(<StatusChip tone='danger'>no</StatusChip>)
    expect(d.container.firstElementChild!.className).toContain('bg-danger-bg')
    const n = render(<StatusChip tone='neutral'>—</StatusChip>)
    expect(n.container.firstElementChild!.className).toContain('bg-muted')
  })

  it('className 透传到根节点', () => {
    const { container } = render(
      <StatusChip tone='warning' className='mt-1'>
        x
      </StatusChip>
    )
    expect(container.firstElementChild!.className).toContain('mt-1')
  })

  it('默认 tone 为 neutral', () => {
    const { container } = render(<StatusChip>x</StatusChip>)
    expect(container.firstElementChild!.className).toContain('bg-muted')
  })
})
