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

  it('有 subtitle 时渲染副标题', () => {
    render(<PageHeader title='公告板' subtitle='重奏与团建信息' />)
    expect(screen.getByText('公告板')).toBeTruthy()
    expect(screen.getByText('重奏与团建信息')).toBeTruthy()
  })

  it('无 subtitle 时不渲染副标题', () => {
    render(<PageHeader title='公告板' />)
    expect(screen.queryByText('重奏与团建信息')).toBeNull()
  })

  it('rightButton 渲染在标题行右侧', () => {
    render(<PageHeader title='日程预约' rightButton={<button>添加预约</button>} />)
    expect(screen.getByText('日程预约')).toBeTruthy()
    expect(screen.getByRole('button', { name: '添加预约' })).toBeTruthy()
  })
})
