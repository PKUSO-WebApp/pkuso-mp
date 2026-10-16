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
    expect(screen.getByLabelText('scoreReader.pen')).toBeTruthy()
    // ⚠️ 外层容器是 `pointer-events: none`（它是个透明的整行盒子，会吃触摸），
    // 而这是**继承**属性 —— 这一层不显式接回 `auto`，整条栏的按钮会全部点不动
    expect((container.firstChild as HTMLElement).style.pointerEvents).toBe('auto')
  })

  it('收起：整条栏都不在，只剩那个「展开」按钮；那一行不吃触摸', () => {
    const { container } = render(<AnnotationBar {...props} />)
    fireEvent.click(screen.getByLabelText('scoreReader.penBarCollapse'))
    // 被收走的是**整条**：工具与第二行（清空）都不在
    expect(screen.queryByText('scoreReader.clear')).toBeNull()
    expect(screen.queryByLabelText('scoreReader.pen')).toBeNull()
    // 但那个 V 必须在（它是唯一的展开入口）
    expect(screen.getByLabelText('scoreReader.penBarExpand')).toBeTruthy()
    // 只剩 V 那一小块占地方：整行是透明的 ⇒ 盒子**按几何命中**，不收手就是看不见的禁区
    expect((container.firstChild as HTMLElement).style.pointerEvents).toBe('none')
  })

  it('收起按钮在**第一行的流里**：与画笔/颜料同一行，且不再用 absolute 钉坐标', () => {
    render(<AnnotationBar {...props} />)
    const toggle = screen.getByLabelText('scoreReader.penBarCollapse')
    // 画笔按钮 → 左组 → 第一行；收起按钮的直接父节点必须就是同一行
    // ⇒ 它与画笔/颜料的垂直居中由 `items-center` 保证，不靠任何独立算出来的坐标。
    //（2026-10-16 之前是 `absolute right-3 top-2`，真机上 V 比旁边那几个按钮低一截）
    const firstRow = screen.getByLabelText('scoreReader.pen').parentElement?.parentElement
    expect(toggle.parentElement).toBe(firstRow)
    expect(toggle.className).toContain('ml-auto')
    expect(toggle.className).not.toContain('absolute')
  })

  it('再点一次 ⇒ 展开回来；工具与按钮都在', () => {
    render(<AnnotationBar {...props} />)
    fireEvent.click(screen.getByLabelText('scoreReader.penBarCollapse'))
    fireEvent.click(screen.getByLabelText('scoreReader.penBarExpand'))
    expect(screen.getByText('scoreReader.clear')).toBeTruthy()
    expect(screen.getByLabelText('scoreReader.pen')).toBeTruthy()
  })
})
