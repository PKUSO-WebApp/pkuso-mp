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
  onDone: vi.fn(),
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

  it('两个出口分在两角（2026-10-16 用户定）：「完成」在第一行右上，「收起」在第二行左下', () => {
    render(<AnnotationBar {...props} />)
    const pen = screen.getByLabelText('scoreReader.pen')
    const firstRow = pen.parentElement?.parentElement // 工具组 → 第一行
    const done = screen.getByLabelText('scoreReader.penDone')
    const collapse = screen.getByLabelText('scoreReader.penBarCollapse')
    // 「完成」在第一行里（它外层是那个 `ml-auto` 盒子）—— 与工具/色块同一行的行尾
    expect(done.parentElement?.parentElement).toBe(firstRow)
    // 「收起」在第二行里（第一行的下一个兄弟节点）
    expect(collapse.parentElement).toBe(firstRow?.nextElementSibling)
    // 都不是钉坐标（那条路踩过 `.ui-scale` 下不重合的坑）
    expect(collapse.className).not.toContain('absolute')
    expect(done.className).not.toContain('absolute')
  })

  it('**只有「展开」带背景**（用户 2026-10-16 定：无背景的它在 UD 模式下几乎看不见）', () => {
    render(<AnnotationBar {...props} />)
    const collapse = screen.getByLabelText('scoreReader.penBarCollapse')
    // 收起：不带底色（它就在栏里，和色块/档位同一层）
    expect(collapse.className).not.toContain('bg-card')
    expect(collapse.className).not.toContain('bg-primary')
    // ⚠️ 但**边框必须留着**：去掉它，可见高度就只剩那行字，和实心的「展开」站一起矮一截
    //（用户 2026-10-16 截图反馈）。盒子一样大靠的是同一串 padding+边框，不是靠透明。
    expect(collapse.className).toContain('border-border')
    expect(collapse.className).not.toContain('border-transparent')
    // 展开：带底色（收起之后它是唯一贴在谱面上的东西）
    fireEvent.click(collapse)
    const expand = screen.getByLabelText('scoreReader.penBarExpand')
    expect(expand.className).toContain('bg-card')
    expect(expand.className).toContain('border')
  })

  it('「完成」用主色实底（用户 2026-10-16 定：bg-card 在栏上太糊，不像按钮）', () => {
    render(<AnnotationBar {...props} />)
    const done = screen.getByLabelText('scoreReader.penDone')
    expect(done.className).toContain('bg-primary')
    expect(done.className).toContain('text-primary-foreground')
  })

  it('收起之后的「展开」在**左边**（与「收起」同侧，用户 2026-10-16 定）', () => {
    const { container } = render(<AnnotationBar {...props} />)
    fireEvent.click(screen.getByLabelText('scoreReader.penBarCollapse'))
    const row = container.firstChild as HTMLElement
    expect(row.className).toContain('justify-start')
    expect(row.className).not.toContain('justify-end')
  })

  it('收起态与展开态**同一高度**：外行 `pb-2` + 内层 `h-8`（少了它按钮会掉下去一截）', () => {
    const { container } = render(<AnnotationBar {...props} />)
    fireEvent.click(screen.getByLabelText('scoreReader.penBarCollapse'))
    const row = container.firstChild as HTMLElement
    // 展开态第二行的行高是 32px（撤销/档位点的 h-8），收起态要复刻这个行高 +
    // 同样的底距，两个状态的按钮才落在同一个 y（真机上量到过 35px 的落差）
    expect(row.className).toContain('pb-2')
    const inner = row.firstElementChild as HTMLElement
    expect(inner.className).toContain('h-8')
  })

  it('「收起」「完成」与「清空」是**同一套尺寸**（用户 2026-10-16 订正：上一版比清空高出一截）', () => {
    render(<AnnotationBar {...props} />)
    const clear = screen.getByText('scoreReader.clear')
    const collapse = screen.getByLabelText('scoreReader.penBarCollapse')
    const done = screen.getByLabelText('scoreReader.penDone')
    for (const b of [collapse, done, clear]) {
      expect(b.className).toContain('rounded-full')
      expect(b.className).toContain('px-3')
      expect(b.className).toContain('py-1')
      expect(b.className).toContain('text-xs')
      // 高度由 padding 决定 ⇒ 不许再写死 h-8（那正是和清空不统一的地方）
      expect(b.className).not.toContain('h-8')
    }
  })

  it('点「完成」⇒ 回调 onDone（退出批注），且不会顺手清空/撤销', () => {
    render(<AnnotationBar {...props} />)
    fireEvent.click(screen.getByLabelText('scoreReader.penDone'))
    expect(props.onDone).toHaveBeenCalledTimes(1)
    expect(props.onClear).not.toHaveBeenCalled()
    expect(props.onUndo).not.toHaveBeenCalled()
  })

  it('再点一次 ⇒ 展开回来；工具与按钮都在', () => {
    render(<AnnotationBar {...props} />)
    fireEvent.click(screen.getByLabelText('scoreReader.penBarCollapse'))
    fireEvent.click(screen.getByLabelText('scoreReader.penBarExpand'))
    expect(screen.getByText('scoreReader.clear')).toBeTruthy()
    expect(screen.getByLabelText('scoreReader.pen')).toBeTruthy()
  })
})
