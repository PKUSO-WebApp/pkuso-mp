import { describe, expect, it } from 'vitest'
import { pageFromScroll, pageTop, pendingPages, stripHeight } from './strip'

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

describe('pendingPages（该给哪些页显示加载圆圈）', () => {
  const H = 500

  it('视口覆盖到的页里，没渲染出来的才算', () => {
    // 视口顶在第 2 页页首、高 1200（覆盖 2/3/4 页），其中 3 已渲染
    expect(pendingPages(H, H, 1200, 6, new Set([3]))).toEqual([2, 4])
  })

  it('左右模式：传「当前页页首 + 页高」退化成一页', () => {
    expect(pendingPages(2 * H, H, H, 6, new Set())).toEqual([3])
    expect(pendingPages(2 * H, H, H, 6, new Set([3]))).toEqual([])
  })

  it('视口只盖到前两页时，第三页**不算**待渲染；再高 1px 才碰到它', () => {
    expect(pendingPages(0, H, 1000, 3, new Set([1, 2]))).toEqual([])
    expect(pendingPages(0, H, 1001, 3, new Set([1, 2]))).toEqual([3])
  })

  it('尺寸还没量到 / 没有页 都返回空', () => {
    expect(pendingPages(0, 0, 1000, 3, new Set())).toEqual([])
    expect(pendingPages(0, H, 1000, 0, new Set())).toEqual([])
  })

  it('滚到条尾之外也不越界（钳进 [1, pageCount]）', () => {
    expect(pendingPages(99999, H, 1000, 4, new Set())).toEqual([4])
    expect(pendingPages(-500, H, 1000, 4, new Set())).toEqual([1, 2])
  })
})
