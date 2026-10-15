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
  it('一进来就是展开的（组件随批注会话挂载 ⇒ 下次进批注必然展开）', () => {
    const { container } = render(<AnnotationBar {...props} />)
    expect(screen.getByLabelText('scoreReader.penBarCollapse')).toBeTruthy()
    expect(screen.getByText('scoreReader.clear')).toBeTruthy()
    expect((container.firstChild as HTMLElement).style.visibility).toBe('')
    // ⚠️ 外层容器是 `pointer-events: none`（它是个透明的整行盒子，会吃触摸），
    // 而这是**继承**属性 —— 这一层不显式接回 `auto`，整条栏的按钮会全部点不动
    expect((container.firstChild as HTMLElement).style.pointerEvents).toBe('auto')
  })

  it('收起：整条栏隐藏，但**布局盒子留着**（那个 V 因此不移位），且只有它能点', () => {
    const { container } = render(<AnnotationBar {...props} />)
    fireEvent.click(screen.getByLabelText('scoreReader.penBarCollapse'))

    const root = container.firstChild as HTMLElement
    // 隐藏而不是不渲染：不渲染会让 V 掉到两行之间（用户 2026-10-16 报的位置问题）
    expect(root.style.visibility).toBe('hidden')
    // 隐藏的盒子按几何照样命中，所以必须显式不吃触摸
    expect(root.style.pointerEvents).toBe('none')

    // V 自己放出来：看得见、也点得着
    const btn = screen.getByLabelText('scoreReader.penBarExpand')
    expect(btn.style.visibility).toBe('visible')
    expect(btn.style.pointerEvents).toBe('auto')
  })

  it('再点一次 ⇒ 展开回来；工具与按钮都在', () => {
    const { container } = render(<AnnotationBar {...props} />)
    fireEvent.click(screen.getByLabelText('scoreReader.penBarCollapse'))
    fireEvent.click(screen.getByLabelText('scoreReader.penBarExpand'))
    expect((container.firstChild as HTMLElement).style.visibility).toBe('')
    expect(screen.getByText('scoreReader.clear')).toBeTruthy()
    expect(screen.getByLabelText('scoreReader.pen')).toBeTruthy()
  })
})
