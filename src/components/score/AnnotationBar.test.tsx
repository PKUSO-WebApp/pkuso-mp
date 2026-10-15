// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AnnotationBar } from './AnnotationBar'

// `ariaLabel` 是 Taro 的属性名，jsdom 里要落成 `aria-label` 才查得到
vi.mock('@tarojs/components', () => {
  const create = (tag: string) => (props: any) => {
    const { ariaLabel, hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, ariaLabel ? { ...rest, 'aria-label': ariaLabel } : rest)
  }
  return { View: create('div'), Button: create('button'), Image: create('img') }
})

// 取词改成「回显 key」：断言就看 key，不吃文案（文案会改，key 相对稳）
vi.mock('@/i18n', () => ({ useT: () => ({ t: (k: string) => k }) }))
vi.mock('@/context/theme-context', () => ({ useThemeContext: () => ({ mode: 'light' }) }))
vi.mock('@/hooks/useUiScale', () => ({ useUiScaleFactor: () => 1 }))

const props = {
  color: '#111111',
  width: 4,
  tool: 'pen' as const,
  onTool: vi.fn(),
  canUndo: false,
  clearPage: 3,
  onColor: vi.fn(),
  onWidth: vi.fn(),
  onUndo: vi.fn(),
  onClear: vi.fn(),
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AnnotationBar 的收起 / 展开', () => {
  it('展开时两行都在（有清空按钮），右上角那个按钮是「收起」', () => {
    render(<AnnotationBar {...props} collapsed={false} onToggleCollapsed={vi.fn()} />)
    expect(screen.getByText('scoreReader.clear')).toBeTruthy()
    expect(screen.getByLabelText('scoreReader.penBarCollapse')).toBeTruthy()
  })

  it('收起时整条栏都不在，只剩最右边那个「展开」按钮', () => {
    render(<AnnotationBar {...props} collapsed onToggleCollapsed={vi.fn()} />)
    // 被收走的是**整条**：第二行（清空）不在，工具按钮也不在
    expect(screen.queryByText('scoreReader.clear')).toBeNull()
    expect(screen.queryByLabelText('scoreReader.pen')).toBeNull()
    // 但必须留一个能把它叫回来的东西
    expect(screen.getByLabelText('scoreReader.penBarExpand')).toBeTruthy()
  })

  it('点那个按钮 ⇒ 回调（收 / 展都是同一个入口）', () => {
    const onToggle = vi.fn()
    render(<AnnotationBar {...props} collapsed={false} onToggleCollapsed={onToggle} />)
    fireEvent.click(screen.getByLabelText('scoreReader.penBarCollapse'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
