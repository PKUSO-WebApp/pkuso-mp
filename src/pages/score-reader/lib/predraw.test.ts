import { describe, expect, it } from 'vitest'
import {
  ALL_LAYERS,
  assignSlot,
  frameForPage,
  missingNeighbor,
  neighborFrames,
  predrawFallback,
  predrawGo,
  spareLayer,
  spareLayerOffscreen,
  NEIGHBOR_MAX_ZOOM,
  PREDRAW_IDLE_MS,
  PREDRAW_WAIT_MS,
  PREDRAW_WARM_GRACE_MS,
  type LayerMetas,
  type PredrawFrame,
} from './predraw'
import type { Layer } from './types'

const frame = (o: Partial<PredrawFrame> = {}): PredrawFrame => ({
  page: 5,
  zoom: 1,
  containerW: 390,
  layer: 'b',
  cssW: 390,
  cssH: 520,
  aspect: 1.33,
  at: 1000,
  ...o,
})

const metas = (o: Partial<LayerMetas> = {}): LayerMetas => ({ a: null, b: null, c: null, ...o })

describe('neighborFrames', () => {
  it('排除显示中的那块；缩放/视口宽对不上的不算', () => {
    const m = metas({
      a: frame({ layer: 'a', page: 4 }),
      b: frame({ layer: 'b', page: 6 }),
      c: frame({ layer: 'c', page: 7 }),
    })
    expect(
      neighborFrames(m, 'b', { zoom: 1, containerW: 390 })
        .map((f) => f.page)
        .sort()
    ).toEqual([4, 7])
    expect(neighborFrames(m, 'b', { zoom: 1.25, containerW: 390 })).toEqual([])
    expect(neighborFrames(m, 'b', { zoom: 1, containerW: 400 })).toEqual([])
  })

  it('没记账的层不算帧', () => {
    expect(neighborFrames(metas(), 'a', { zoom: 1, containerW: 390 })).toEqual([])
  })
})

describe('frameForPage', () => {
  it('找得到就是它，找不到给 null', () => {
    const fs = [frame({ page: 4, layer: 'a' }), frame({ page: 6, layer: 'c' })]
    expect(frameForPage(fs, 6)?.layer).toBe('c')
    expect(frameForPage(fs, 5)).toBeNull()
  })
})

describe('missingNeighbor（预绘制的目标）', () => {
  it('先补下一页、再补上一页；两个都在就 null（什么都不用做）', () => {
    expect(missingNeighbor(5, 10, [])).toBe(6)
    expect(missingNeighbor(5, 10, [frame({ page: 6 })])).toBe(4)
    expect(missingNeighbor(5, 10, [frame({ page: 6 }), frame({ page: 4 })])).toBeNull()
  })

  it('边界：第一页没有上一页、末页没有下一页、单页册子什么都不缺', () => {
    expect(missingNeighbor(1, 10, [])).toBe(2)
    expect(missingNeighbor(10, 10, [])).toBe(9)
    expect(missingNeighbor(1, 1, [])).toBeNull()
  })
})

describe('spareLayer（该写哪块）', () => {
  const all: Layer[] = ['a', 'b', 'c']

  it('绝不写显示中的那块；优先写没记账的', () => {
    expect(spareLayer(all, 'a', metas({ a: frame({ layer: 'a', page: 4 }) }), 5)).toBe('b')
  })

  it('两块都有记账时：先弃远的、保近的', () => {
    const m = metas({
      b: frame({ layer: 'b', page: 40 }), // 很远
      c: frame({ layer: 'c', page: 6 }),
    })
    expect(spareLayer(all, 'a', m, 5)).toBe('b')
  })

  it('同样近时弃「上一页」、保「下一页」', () => {
    const m = metas({
      b: frame({ layer: 'b', page: 4 }), // 上一页
      c: frame({ layer: 'c', page: 6 }), // 下一页
    })
    expect(spareLayer(all, 'a', m, 5)).toBe('b')
  })
})

describe('predrawFallback（采纳失败后的兜底）', () => {
  const base = { adopt: true, target: 6, zoom: 1, currentPage: 6, currentZoom: 1 }

  it('用户还在等这一页 ⇒ 交回常规路径', () => {
    expect(predrawFallback(base)).toEqual({ page: 6, zoom: 1 })
  })

  it('没被采纳过（用户没翻到它）⇒ 不用管：备用块留着下次用', () => {
    expect(predrawFallback({ ...base, adopt: false })).toBeNull()
  })

  it('用户已经翻走 / 缩放变了 ⇒ 交回去会覆盖更新的请求，不能交', () => {
    expect(predrawFallback({ ...base, currentPage: 7 })).toBeNull()
    expect(predrawFallback({ ...base, currentZoom: 1.25 })).toBeNull()
  })

  // ⚠️ 这里**没有**「被失效打断（回前台 / 转屏 / 换册）也要交回」的用例，是刻意的：
  // predrawFallback 的入参里根本没有 cancelled / 世代，所以传进去也只是被忽略——
  // 那样的用例断言结果与第 1 条逐字相同，是恒真的，留着只会造假信心。
  // 该性质由**结构**保证：签名里没有 cancelled + 调用点只传这五个字段（见 predraw.ts 的注释）。
})

describe('预绘制的两个时间常量', () => {
  it('重新检查的间隔要明显小于等待宽限，否则「等一次」就到头了', () => {
    expect(PREDRAW_WAIT_MS).toBeLessThan(PREDRAW_WARM_GRACE_MS / 2)
  })

  it('等动画停稳的时间要大于翻页动画时长（否则会写进正在滑的那块画布）', () => {
    // TURN_MS(180) + 停靠余量(40) = 220
    expect(PREDRAW_IDLE_MS).toBeGreaterThan(220)
  })
})

describe('predrawGo', () => {
  const base = {
    drawing: false,
    zoom: 1,
    pinching: false,
    animating: false,
    queueBusy: false,
    target: 4,
    warm: true,
    waitedMs: 0,
  }

  it('条件齐了就开工', () => {
    expect(predrawGo(base)).toBe('start')
  })

  it('正在落笔/落擦时不做（否则它画完触发批注层重绘，正画着的笔迹会闪一下）', () => {
    expect(predrawGo({ ...base, drawing: true })).toBe('skip')
  })

  it('没有目标页就不做', () => {
    expect(predrawGo({ ...base, target: null })).toBe('skip')
  })

  it('放大后**照做**（放大读谱也会翻页）；只有超过 NEIGHBOR_MAX_ZOOM 才退避', () => {
    expect(predrawGo({ ...base, zoom: 1.5 })).toBe('start')
    expect(predrawGo({ ...base, zoom: NEIGHBOR_MAX_ZOOM })).toBe('start')
    // 再大：三块画布的位图随 zoom² 涨（单块可到 ~48MB），不值得为它冒内存风险
    expect(predrawGo({ ...base, zoom: NEIGHBOR_MAX_ZOOM + 0.01 })).toBe('skip')
  })

  it('捏合中 / 动画中 / 队列忙 都不做（让位给交互）', () => {
    expect(predrawGo({ ...base, pinching: true })).toBe('skip')
    expect(predrawGo({ ...base, animating: true })).toBe('skip')
    expect(predrawGo({ ...base, queueBusy: true })).toBe('skip')
  })

  it('还没预热到就先等（抢在泵前面发是重复请求）；超过宽限就不等了', () => {
    expect(predrawGo({ ...base, warm: false, waitedMs: 0 })).toBe('wait')
    expect(predrawGo({ ...base, warm: false, waitedMs: PREDRAW_WARM_GRACE_MS })).toBe('wait')
    expect(predrawGo({ ...base, warm: false, waitedMs: PREDRAW_WARM_GRACE_MS + 1 })).toBe('start')
  })
})

describe('spareLayerOffscreen（后台只准写视野外的画布）', () => {
  const all: Layer[] = ['a', 'b', 'c']
  const slot = (o: Partial<Record<Layer, number | null>>) => (l: Layer) => o[l] ?? null

  it('视野内的块一律不写（UD 三块都可见时 ⇒ 什么都不做）', () => {
    // 视口跨 4..6，三块分别装着 5/4/6 ⇒ **都在视野内** ⇒ 哪块都不许写
    expect(
      spareLayerOffscreen(all, 'b', metas(), 4, slot({ a: 5, b: 4, c: 6 }), { first: 4, last: 6 })
    ).toBeNull()
  })

  it('视野外的那块可以写（UD 里 n−1 通常在视口上方）', () => {
    // 视野是 4..5，a 装着 3（在视野上方）⇒ 可以拿它备 n+1
    expect(
      spareLayerOffscreen(all, 'b', metas(), 4, slot({ a: 3, b: 4, c: 5 }), { first: 4, last: 5 })
    ).toBe('a')
  })

  it('空块随便写（它没内容可搅动）；装东西的块在尺寸没量到时保守不写', () => {
    expect(spareLayerOffscreen(all, 'b', metas(), 4, slot({ b: 4 }), { first: 4, last: 4 })).toBe(
      'a'
    )
    // 尺寸还没量到 ⇒ 无从判断哪块在视野外：**装过东西的块一律不碰**（这里三块都有内容）
    expect(spareLayerOffscreen(all, 'b', metas(), 4, slot({ a: 3, b: 4, c: 5 }), null)).toBeNull()
  })

  it('多块可选时仍按「最该被写掉」挑（远的先弃）', () => {
    expect(
      spareLayerOffscreen(
        all,
        'b',
        metas({ a: frame({ layer: 'a', page: 9 }), c: frame({ layer: 'c', page: 1 }) }),
        4,
        slot({ a: 9, b: 4, c: 1 }),
        { first: 4, last: 4 }
      )
    ).toBe('a')
  })
})

describe('assignSlot（同一页只能由一块画布占着）', () => {
  const slots = (o: Partial<Record<Layer, number | null>> = {}): Record<Layer, number | null> => ({
    a: null,
    b: null,
    c: null,
    ...o,
  })

  it('交给空块：只有那一块变了', () => {
    expect(assignSlot(slots({ a: 1 }), 'b', 2)).toEqual({ a: 1, b: 2, c: null })
  })

  it('没变化时原样返回（React 状态不白换引用）', () => {
    const s = slots({ a: 2, b: 1 })
    expect(assignSlot(s, 'a', 2)).toBe(s)
  })

  it('同一页在别处也占着 ⇒ 交给新块，旧块的记账清掉（它退回屏外）', () => {
    expect(assignSlot(slots({ a: 2, b: 1, c: 3 }), 'a', 3)).toEqual({ a: 3, b: 1, c: null })
  })

  it('清掉的只是**同一页**那些，别页不动', () => {
    expect(assignSlot(slots({ a: 5, b: 5, c: 5 }), 'c', 5)).toEqual({ a: null, b: null, c: 5 })
  })
})

/**
 * 摆位/帧记账的最小模型：**照 index.tsx 里 doRender 与 invalidatePredraw 的规则**推
 * （挑块用真的 spareLayer、落摆位用真的 assignSlot），用来复现真机那条路径。
 */
function makeLayerModel() {
  let slots: Record<Layer, number | null> = { a: null, b: null, c: null }
  let m: LayerMetas = { a: null, b: null, c: null }
  let active: Layer = 'a' // index.tsx 的初值
  return {
    slots: () => slots,
    /** doRender：挑一块「不是显示中的」写进去；写成功才落摆位 */
    render(page: number) {
      const layer = spareLayer(ALL_LAYERS, active, m, page)
      m = { ...m, [layer]: frame({ page, layer }) }
      slots = assignSlot(slots, layer, page)
      active = layer
    },
    /** invalidatePredraw：帧全部作废，**摆位不动**（2026-10-11 起） */
    invalidate() {
      m = { a: null, b: null, c: null }
    },
    /** 有没有哪一页被两块同时占着（上下模式里 = 叠在同一位置画两遍） */
    doubledPages(): number[] {
      const held = ALL_LAYERS.map((l) => slots[l]).filter((p): p is number => p !== null)
      return [...new Set(held.filter((p, i) => held.indexOf(p) !== i))]
    },
  }
}

describe('上下模式：翻页 + 放大后重渲（真机「荧光笔松手后几乎不透明」的根因）', () => {
  it('顺次翻三页各自占一块，谁都不重复', () => {
    const L = makeLayerModel()
    L.render(1)
    L.render(2)
    L.render(3)
    expect(L.slots()).toEqual({ a: 2, b: 1, c: 3 })
    expect(L.doubledPages()).toEqual([])
  })

  it('放大后重渲当前页 ⚠️ 不能让它同时占两块', () => {
    const L = makeLayerModel()
    L.render(1)
    L.render(2)
    L.render(3)
    // 捏合放大 ⇒ syncView 重渲当前页；此时帧全作废、摆位还在 ⇒ 挑块挑不到「装着别页的」
    L.invalidate()
    L.render(3)
    expect(L.doubledPages()).toEqual([])
    // 当前页由新块显示，原来的那块退回屏外（c 上那一页已被顶掉）
    expect(L.slots()).toEqual({ a: 3, b: 1, c: null })
  })

  it('切后台回来（useDidShow 也走同一条重渲）同样不重复', () => {
    const L = makeLayerModel()
    L.render(1)
    L.render(2)
    L.invalidate()
    L.render(2)
    expect(L.doubledPages()).toEqual([])
  })
})
