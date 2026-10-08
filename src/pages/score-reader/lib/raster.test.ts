import { describe, expect, it, vi } from 'vitest'
import {
  DPR,
  MAX_RASTER_EDGE,
  MAX_RASTER_PIXELS,
  drawMark,
  frameInk,
  markKept,
  medianHex,
  rasterDpr,
  sampleEdgeColors,
} from './raster'
import type { CanvasCtx, CanvasNode } from './types'

const WHITE = [255, 255, 255, 255]
const BLACK = [0, 0, 0, 255]

/** 假 2D 上下文：setTransform/fillRect 记进 calls，getImageData 由用例提供 */
function fakeCtx(getImageData?: CanvasCtx['getImageData']): {
  calls: string[]
  ctx: CanvasCtx
} {
  const calls: string[] = []
  const ctx: CanvasCtx = {
    setTransform: (...a: number[]) => calls.push(`setTransform(${a.join(',')})`),
    fillRect: (...a: number[]) => calls.push(`fillRect(${a.join(',')})`),
    getImageData:
      getImageData ??
      (() => {
        throw new Error('probe failed')
      }),
    clearRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    drawImage: () => {},
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
  }
  return { calls, ctx }
}

/** 假画布节点：getContext 抛错用 ctxThrows 模拟 */
function fakeNode(opts: {
  width?: number
  height?: number
  /** 每次 getImageData 依次返回的像素行 */
  rows?: number[][]
  ctxThrows?: boolean
  probeThrows?: boolean
}): { calls: string[]; node: CanvasNode } {
  let rowIdx = 0
  const { calls, ctx } = fakeCtx(() => {
    if (opts.probeThrows) throw new Error('probe failed')
    return { data: opts.rows?.[rowIdx++] ?? [] }
  })
  return {
    calls,
    node: {
      width: opts.width ?? 100,
      height: opts.height ?? 100,
      getContext: () => {
        if (opts.ctxThrows) throw new Error('no ctx')
        return ctx
      },
    },
  }
}

describe('rasterDpr', () => {
  it('小画布用满 DPR', () => {
    expect(rasterDpr(300, 400)).toBe(DPR)
  })

  it('尺寸非法（尚未测量）时退回 DPR', () => {
    expect(rasterDpr(0, 100)).toBe(DPR)
    expect(rasterDpr(100, -1)).toBe(DPR)
  })

  it('任意尺寸下都不越位图上限——这正是这个函数存在的理由', () => {
    // 超大画布在真机上会分配失败、画不出来（表现为「整页白」）。
    // 逐点验一遍不变量，而不是只挑一两个尺寸看它「变小了」。
    // 面积用相对容差：dpr 是浮点算出来的，20000×20000 会算出 12000000.000000002，
    // 比上限多 2e-9 个像素——对画布分配毫无意义，但严格的 <= 会红。
    const slack = MAX_RASTER_PIXELS * 1e-9
    const sizes = [1, 100, 500, 1000, 2000, 4000, 8000, 20000]
    for (const w of sizes) {
      for (const h of sizes) {
        const dpr = rasterDpr(w, h)
        expect(dpr, `w=${w} h=${h}`).toBeGreaterThan(0)
        expect(w * dpr, `单边 w=${w} h=${h}`).toBeLessThanOrEqual(MAX_RASTER_EDGE)
        expect(h * dpr, `单边 h=${w} h=${h}`).toBeLessThanOrEqual(MAX_RASTER_EDGE)
        expect(w * dpr * (h * dpr), `总量 w=${w} h=${h}`).toBeLessThanOrEqual(
          MAX_RASTER_PIXELS + slack
        )
      }
    }
  })

  it('越大压得越狠（单调不增）', () => {
    let prev = Number.POSITIVE_INFINITY
    for (const w of [200, 1000, 2000, 4000, 8000]) {
      const dpr = rasterDpr(w, w)
      expect(dpr).toBeLessThanOrEqual(prev)
      prev = dpr
    }
  })
})

describe('drawMark / markKept', () => {
  it('drawMark 把变换复位后点一个洋红方块', () => {
    const { calls, node } = fakeNode({})
    drawMark(node)
    expect(calls).toEqual(['setTransform(1,0,0,1,0,0)', 'fillRect(0,0,4,4)'])
  })

  it('getContext 抛错时静默（不影响主流程）', () => {
    const { node } = fakeNode({ ctxThrows: true })
    expect(() => drawMark(node)).not.toThrow()
  })

  it('markKept：洋红 → true，白 → false', () => {
    expect(markKept(fakeNode({ rows: [[255, 0, 255, 255]] }).node)).toBe(true)
    expect(markKept(fakeNode({ rows: [WHITE] }).node)).toBe(false)
  })

  it('markKept：探测失败算「记号不在」（宁可认为渲染碰过画布）', () => {
    expect(markKept(fakeNode({ probeThrows: true }).node)).toBe(false)
  })
})

describe('medianHex / sampleEdgeColors（灰带的纸色采样）', () => {
  it('medianHex 逐通道取中位数：少数离群点（压到墨上）改不了结论', () => {
    expect(medianHex([WHITE, BLACK, WHITE])).toBe('#ffffff')
    expect(medianHex([WHITE, WHITE, BLACK, WHITE, WHITE])).toBe('#ffffff')
    expect(medianHex([[1, 2, 3]])).toBe('#010203')
  })

  it('medianHex 补零与钳位（越界/小数都不该写出非法色值）', () => {
    expect(medianHex([[0, 15, 255]])).toBe('#000fff')
    expect(medianHex([[300, -5, 12.6]])).toBe('#ff000d')
  })

  it('sampleEdgeColors 采的是**贴边两行**：离边 1% 页高（避开扫描压边），顶底各一条', () => {
    const spy = vi.fn((_x: number, _y: number) => ({ data: [200, 200, 200, 255] }))
    const node: CanvasNode = {
      width: 1000,
      height: 2000,
      getContext: () => ({ ...fakeCtx().ctx, getImageData: spy }),
    }
    expect(sampleEdgeColors(node)).toEqual({ top: '#c8c8c8', bottom: '#c8c8c8' })
    const ys = [...new Set(spy.mock.calls.map((c) => c[1]))].sort((a, b) => a - b)
    expect(ys).toEqual([20, 1979]) // inset = max(2, 1% × 2000) = 20；底行是 h-1-inset
  })

  it('顶边与底边各采各的（不是一条色用两遍）', () => {
    let call = 0
    const node: CanvasNode = {
      width: 1000,
      height: 1000,
      getContext: () => ({
        ...fakeCtx().ctx,
        getImageData: () => {
          call += 1
          if (call <= 5) return { data: call === 3 ? BLACK : WHITE } // 顶边：4 白 1 黑
          return { data: BLACK } // 底边：全黑
        },
      }),
    }
    expect(sampleEdgeColors(node)).toEqual({ top: '#ffffff', bottom: '#000000' })
  })

  it('取不到像素 → null（调用方保持原色，不虚构）', () => {
    expect(sampleEdgeColors(fakeNode({ probeThrows: true }).node)).toBeNull()
    expect(sampleEdgeColors(fakeNode({ ctxThrows: true }).node)).toBeNull()
    expect(sampleEdgeColors(fakeNode({ width: 0 }).node)).toBeNull()
  })
})

describe('frameInk', () => {
  it('三条采样行全白 → 0（渲染静默失败的样子）', () => {
    expect(
      frameInk(fakeNode({ rows: [[255, 255, 255, 255], [250, 250, 250, 255], WHITE] }).node)
    ).toBe(0)
  })

  it('数出有几条采样行非白', () => {
    expect(frameInk(fakeNode({ rows: [BLACK, WHITE, WHITE] }).node)).toBe(1)
    expect(frameInk(fakeNode({ rows: [BLACK, WHITE, BLACK] }).node)).toBe(2)
    expect(frameInk(fakeNode({ rows: [BLACK, BLACK, BLACK] }).node)).toBe(3)
  })

  it('阈值是 245：略灰也算有墨（抗锯齿的淡笔迹不能被当成白）', () => {
    expect(frameInk(fakeNode({ rows: [[244, 244, 244, 255]] }).node)).toBe(1)
    expect(frameInk(fakeNode({ rows: [[246, 246, 246, 255]] }).node)).toBe(0)
  })

  it('探测本身失败 → -1（不参与判定，与「确实全白」区分开）', () => {
    expect(frameInk(fakeNode({ probeThrows: true }).node)).toBe(-1)
  })

  it('画布尺寸为 0 → -1', () => {
    expect(frameInk(fakeNode({ width: 0 }).node)).toBe(-1)
    expect(frameInk(fakeNode({ height: 0 }).node)).toBe(-1)
  })

  it('采样的是三条整行，且行号按高度取值', () => {
    const spy = vi.fn((_x: number, _y: number, _w: number, _h: number) => ({ data: WHITE }))
    const node: CanvasNode = {
      width: 100,
      height: 400,
      getContext: () => ({ ...fakeCtx().ctx, getImageData: spy }),
    }
    frameInk(node)
    expect(spy.mock.calls).toEqual([
      [0, 100, 100, 1],
      [0, 200, 100, 1],
      [0, 300, 100, 1],
    ])
  })
})
