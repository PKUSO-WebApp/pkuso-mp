import { describe, expect, it } from 'vitest'
import { pageFromScroll, pageTop, splitStrokeByStrip, stripHeight } from './strip'

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
