import { describe, expect, it } from 'vitest'
import {
  pageCoordOf,
  pageFromScroll,
  pageTop,
  splitStrokeByStrip,
  stripHeight,
  windowYOf,
} from './strip'

describe('竖条几何', () => {
  it('条高 = 页高 × 页数；页顶 = (页码 − 1) × 页高（页与页零间隔）', () => {
    expect(stripHeight(500, 4)).toBe(2000)
    expect(pageTop(1, 500)).toBe(0)
    expect(pageTop(3, 500)).toBe(1000)
    // 相邻页首尾相接：第 2 页的底边正好是第 3 页的顶边
    expect(pageTop(2, 500) + 500).toBe(pageTop(3, 500))
  })

  it('页高/页数非法时全给 0（还没量到尺寸也不该算出负数）', () => {
    expect(stripHeight(0, 5)).toBe(0)
    expect(stripHeight(500, 0)).toBe(0)
    expect(pageTop(0, 500)).toBe(0)
  })

  it('滚动位置 → 页码：取**视口顶边**落在哪一页', () => {
    expect(pageFromScroll(0, 500, 4)).toBe(1)
    expect(pageFromScroll(499, 500, 4)).toBe(1)
    expect(pageFromScroll(500, 500, 4)).toBe(2) // 正好顶到第 2 页页首
    expect(pageFromScroll(1250, 500, 4)).toBe(3)
  })

  it('滚到两端之外也钳在 [1, pageCount]（条比视口短的机型上会发生）', () => {
    expect(pageFromScroll(-300, 500, 4)).toBe(1)
    expect(pageFromScroll(99999, 500, 4)).toBe(4)
    expect(pageFromScroll(0, 0, 4)).toBe(1)
  })
})

describe('splitStrokeByStrip（一笔按页切开）', () => {
  it('页内的那一笔（左右模式 py 也带页号）只切出一段', () => {
    expect(
      splitStrokeByStrip(
        [
          [0.1, 2.2],
          [0.3, 2.4],
          [0.5, 2.9],
        ],
        3
      )
    ).toEqual([
      {
        page: 3,
        points: [
          [0.1, 0.2],
          [0.3, 0.4],
          [0.5, 0.9],
        ],
      },
    ])
  })

  it('跨页的一笔切成两段，各自记到各自的页上', () => {
    expect(
      splitStrokeByStrip(
        [
          [0.1, 1.8],
          [0.2, 1.95],
          [0.3, 2.05],
          [0.4, 2.3],
        ],
        4
      )
    ).toEqual([
      {
        page: 2,
        points: [
          [0.1, 0.8],
          [0.2, 0.95],
        ],
      },
      {
        page: 3,
        points: [
          [0.3, 0.05],
          [0.4, 0.3],
        ],
      },
    ])
  })

  it('正好落在页首 / 条两端：页首算下一页的开头，末页底边算最后一页的页尾', () => {
    expect(splitStrokeByStrip([[0.5, 1]], 3)).toEqual([{ page: 2, points: [[0.5, 0]] }])
    expect(splitStrokeByStrip([[0.5, 3]], 3)).toEqual([{ page: 3, points: [[0.5, 1]] }])
    // 起点在条外（负数）：钳到第 1 页页首
    expect(splitStrokeByStrip([[0.5, -0.4]], 3)).toEqual([{ page: 1, points: [[0.5, 0]] }])
  })

  it('空输入 / 页数非法时切出空数组', () => {
    expect(splitStrokeByStrip([], 3)).toEqual([])
    expect(splitStrokeByStrip([[0, 0]], 0)).toEqual([])
  })
})

describe('笔迹坐标换算（屏幕 ↔ 页坐标）', () => {
  const H = 500

  it('画出来的位置 == 手指的位置（两种模式都成立）——这是这两个真机 bug 的共同判据', () => {
    // 左右模式：第 5 页（零点 = 4），窗口一页高
    expect(windowYOf(pageCoordOf(300, 40, H, 4, 1), 4, H)).toBeCloseTo(260, 6)
    // 上下模式：零点 = 2.24（锚点不是页高的整数倍，很常见），窗口 2.4 页高
    const base = 2.24
    expect(windowYOf(pageCoordOf(300, 40, H, base, 2.4), base, H)).toBeCloseTo(260, 6)
  })

  it('窗口下半部的点**不许**被钳到同一条线上（真机「塌缩成一条线」的成因）', () => {
    const y = 40 + H * 1.2 // 落在窗口的第二页里
    expect(pageCoordOf(y, 40, H, 2, 2.4)).toBeCloseTo(3.2, 6)
    // 旋钮：把窗口高度当成一页，这里立刻塌缩成同一个值 —— 用例要能看出这两种的区别
    expect(pageCoordOf(y, 40, H, 2, 1)).toBe(3)
    expect(pageCoordOf(y + 77, 40, H, 2, 1)).toBe(3)
  })

  it('越界钳进窗口两端（含 px 为负、页面被拖出屏幕的情形）', () => {
    expect(pageCoordOf(-999, 40, H, 3, 2.4)).toBe(3)
    expect(pageCoordOf(99999, 40, H, 3, 2.4)).toBeCloseTo(5.4, 6)
  })
})
