import { describe, expect, it } from 'vitest'
import { pageFromScroll, pageTop, stripHeight } from './strip'

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
