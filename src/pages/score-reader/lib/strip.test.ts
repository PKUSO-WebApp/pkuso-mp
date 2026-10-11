import { describe, expect, it } from 'vitest'
import {
  nextVisibleToRender,
  pageFromScroll,
  pageTop,
  pendingPages,
  stripHeight,
  stripViewport,
  visibleRange,
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

describe('stripViewport（基准线 = 菜单栏下沿）', () => {
  const base = { pageH: 500, pageCount: 4, containerH: 800, insetTop: 44, insetBottom: 34 }

  it('基准线在条内的位置 = 上内缩 − 平移：页顶对齐菜单栏下沿时为 0', () => {
    expect(stripViewport({ ...base, panY: 0 }).scroll).toBe(44) // 页顶对齐屏幕顶 ⇒ 基准线落在页内 44 处
    expect(stripViewport({ ...base, panY: 44 }).scroll).toBe(0) // 页顶对齐菜单栏下沿 ⇒ 基准线正是页首
    expect(stripViewport({ ...base, panY: -956 }).scroll).toBe(1000) // 滚到第 3 页页首
  })

  it('可用高按工具条内缩；maxScroll 是「条尾贴上工具条」那一刻', () => {
    const v = stripViewport({ ...base, panY: 0 })
    expect(v.usableH).toBe(722) // 800 − 44 − 34
    expect(v.maxScroll).toBe(1278) // 条高 2000 − 722：再往下滚条尾就撞底栏了
  })

  it('内缩全零时退化成从前（屏幕顶边、整屏高、条高−容器高）', () => {
    const v = stripViewport({
      pageH: 500,
      pageCount: 4,
      containerH: 800,
      insetTop: 0,
      insetBottom: 0,
      panY: -300,
    })
    expect(v).toEqual({ scroll: 300, usableH: 800, maxScroll: 1200 })
  })

  it('条比可用视口还矮 ⇒ maxScroll 为 0（判据里不该出现负数）', () => {
    expect(
      stripViewport({
        pageH: 500,
        pageCount: 1,
        containerH: 800,
        insetTop: 44,
        insetBottom: 34,
        panY: 0,
      }).maxScroll
    ).toBe(0)
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

describe('nextVisibleToRender（UD：该立刻排渲染的那一页）', () => {
  it('往下滚取最靠下的一页（滚进来的那一眼），往上滚取最靠上的', () => {
    expect(nextVisibleToRender([4, 5, 6], 1)).toBe(6)
    expect(nextVisibleToRender([4, 5, 6], -1)).toBe(4)
    expect(nextVisibleToRender([4, 5, 6], 0)).toBe(4)
  })

  it('没有待渲染的页 ⇒ null（不排空活）', () => {
    expect(nextVisibleToRender([], 1)).toBeNull()
  })
})

describe('visibleRange（视口盖到哪几页）', () => {
  it('与 pendingPages 同一判据：闭区间、钳进 [1, pageCount]', () => {
    expect(visibleRange(0, 500, 1200, 6)).toEqual({ first: 1, last: 3 })
    // 顶边在第 3 页中间 ⇒ 视口 500 跨到第 4 页（页界与视口不齐时本来就跨两页）
    expect(visibleRange(1250, 500, 500, 6)).toEqual({ first: 3, last: 4 })
    expect(visibleRange(-300, 500, 1000, 6)).toEqual({ first: 1, last: 2 })
    expect(visibleRange(99999, 500, 1000, 4)).toEqual({ first: 4, last: 4 })
  })

  it('尺寸没量到 / 没有页 ⇒ null（调用方别拿它当「视野空」用）', () => {
    expect(visibleRange(0, 0, 1000, 3)).toBeNull()
    expect(visibleRange(0, 500, 1000, 0)).toBeNull()
  })
})
