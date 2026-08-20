// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Card } from './Card'

vi.mock('@tarojs/components', () => {
  const create = (tag: 'div' | 'span' | 'button') => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span'), Button: create('button') }
})

describe('Card', () => {
  afterEach(cleanup)

  it('渲染 children', () => {
    render(
      <Card>
        <span>内容</span>
      </Card>
    )
    expect(screen.getByText('内容')).toBeTruthy()
  })

  it('传入 className 合并', () => {
    const { container } = render(<Card className='custom'>x</Card>)
    expect(container.firstElementChild!.className).toContain('custom')
  })

  it('onClick 使卡片可点击', () => {
    const onClick = vi.fn()
    render(<Card onClick={onClick}>可点击</Card>)
    fireEvent.click(screen.getByText('可点击'))
    expect(onClick).toHaveBeenCalled()
  })

  it('无 onClick 时渲染 View（div）', () => {
    const { container } = render(<Card>div</Card>)
    expect(container.firstElementChild!.tagName).toBe('DIV')
  })

  it('有 onClick 时仍渲染 View（div）——原生 Button 的事件模型会吞掉子元素 catchtap，改用 View', () => {
    const { container } = render(<Card onClick={vi.fn()}>btn</Card>)
    expect(container.firstElementChild!.tagName).toBe('DIV')
  })
})
