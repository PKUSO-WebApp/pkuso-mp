// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PageHeader } from './page-header'

vi.mock('@tarojs/components', () => {
  const create = (tag: string) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span') }
})

describe('PageHeader', () => {
  afterEach(() => {
    cleanup()
  })

  it('仅 title 时渲染主标题', () => {
    render(<PageHeader title='公告板' />)
    expect(screen.getByText('公告板')).toBeTruthy()
  })


  it('rightButton 渲染在标题行右侧', () => {
    render(<PageHeader title='日程预约' rightButton={<button>添加预约</button>} />)
    expect(screen.getByText('日程预约')).toBeTruthy()
    expect(screen.getByRole('button', { name: '添加预约' })).toBeTruthy()
  })
})
