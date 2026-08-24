// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SegmentTabs } from './SegmentTabs'

const tabs = [
  { key: 'all', label: '全部' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已驳回' },
]

vi.mock('@tarojs/components', () => {
  const create = (tag: any) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span') }
})

describe('SegmentTabs', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('渲染所有 tab 标签', () => {
    render(<SegmentTabs tabs={tabs} value='all' onChange={vi.fn()} />)
    expect(screen.getByText('全部')).toBeTruthy()
    expect(screen.getByText('已通过')).toBeTruthy()
    expect(screen.getByText('已驳回')).toBeTruthy()
  })

  it('点击非激活 tab 回调对应 key', () => {
    const onChange = vi.fn()
    render(<SegmentTabs tabs={tabs} value='all' onChange={onChange} />)
    fireEvent.click(screen.getByText('已驳回'))
    expect(onChange).toHaveBeenCalledWith('rejected')
  })
})
