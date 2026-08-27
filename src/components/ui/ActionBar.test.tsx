// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ActionBar } from './ActionBar'

vi.mock('@tarojs/components', () => {
  const create = (tag: 'div' | 'span' | 'button') => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span'), Button: create('button') }
})

describe('ActionBar', () => {
  afterEach(cleanup)

  it('渲染 children', () => {
    render(
      <ActionBar>
        <button>取消</button>
        <button>提交</button>
      </ActionBar>
    )
    expect(screen.getByText('取消')).toBeTruthy()
    expect(screen.getByText('提交')).toBeTruthy()
  })

  it('应用右对齐操作行布局类', () => {
    const { container } = render(<ActionBar>x</ActionBar>)
    const cls = container.firstElementChild!.className
    expect(cls).toContain('flex')
    expect(cls).toContain('items-center')
    expect(cls).toContain('justify-end')
    expect(cls).toContain('gap-2')
  })

  it('className 与默认布局类合并', () => {
    const { container } = render(<ActionBar className='mt-3'>x</ActionBar>)
    const cls = container.firstElementChild!.className
    expect(cls).toContain('mt-3')
    expect(cls).toContain('justify-end')
  })
})
