import { describe, expect, it } from 'vitest'
import type { AnnoStroke } from '@/lib/annotation'
import { drawPolylineOn, drawStrokeOn, strokeHitByPoint } from './anno-draw'

/** 假 2D 上下文：只记调用顺序，够验「画到哪、什么样式」 */
function fakeCtx() {
  const calls: string[] = []
  const ctx = {
    beginPath: () => calls.push('beginPath'),
    moveTo: (x: number, y: number) => calls.push(`moveTo(${x},${y})`),
    lineTo: (x: number, y: number) => calls.push(`lineTo(${x},${y})`),
    stroke: () => calls.push('stroke'),
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
  }
  return { calls, ctx }
}

describe('drawPolylineOn', () => {
  it('归一化坐标（0~1）按画布尺寸换算成像素', () => {
    const { calls, ctx } = fakeCtx()
    drawPolylineOn(
      ctx as never,
      [
        [0, 0],
        [0.5, 0.25],
        [1, 1],
      ],
      '#f00',
      0.004,
      200,
      400
    )
    expect(calls).toEqual([
      'beginPath',
      'moveTo(0,0)',
      'lineTo(100,100)',
      'lineTo(200,400)',
      'stroke',
    ])
  })

  it('首点 moveTo、其余 lineTo（少一笔多余的连线）', () => {
    const { calls, ctx } = fakeCtx()
    drawPolylineOn(ctx as never, [[0.1, 0.1]], '#f00', 0.004, 100, 100)
    expect(calls.filter((c) => c.startsWith('lineTo'))).toEqual([])
    expect(calls.filter((c) => c.startsWith('moveTo'))).toHaveLength(1)
  })

  it('空点集什么都不画', () => {
    const { calls, ctx } = fakeCtx()
    drawPolylineOn(ctx as never, [], '#f00', 0.004, 100, 100)
    expect(calls).toEqual([])
  })

  it('线宽按画布宽度换算成像素（笔宽是画布宽的比例，不是像素）', () => {
    const a = fakeCtx()
    drawPolylineOn(
      a.ctx as never,
      [
        [0, 0],
        [1, 1],
      ],
      '#f00',
      0.008,
      750,
      1000
    )
    expect(a.ctx.lineWidth).toBe(6) // 0.008 × 750

    const b = fakeCtx()
    drawPolylineOn(
      b.ctx as never,
      [
        [0, 0],
        [1, 1],
      ],
      '#f00',
      0.004,
      1000,
      1400
    )
    expect(b.ctx.lineWidth).toBe(4) // 0.004 × 1000
  })

  it('线宽有 1px 下限（画布很窄时仍看得见）', () => {
    const { ctx } = fakeCtx()
    drawPolylineOn(
      ctx as never,
      [
        [0, 0],
        [1, 1],
      ],
      '#f00',
      0.004,
      100,
      140
    )
    expect(ctx.lineWidth).toBe(1) // 0.004 × 100 = 0.4 → 抬到 1
  })

  it('笔迹样式：圆头圆角（折线拐点不生硬）', () => {
    const { ctx } = fakeCtx()
    drawPolylineOn(
      ctx as never,
      [
        [0, 0],
        [1, 1],
      ],
      '#abcdef',
      0.004,
      100,
      100
    )
    expect(ctx.strokeStyle).toBe('#abcdef')
    expect(ctx.lineCap).toBe('round')
    expect(ctx.lineJoin).toBe('round')
  })
})

describe('drawStrokeOn', () => {
  it('把笔迹的点/颜色/线宽原样转交给折线绘制', () => {
    const { calls, ctx } = fakeCtx()
    const stroke = {
      points: [
        [0, 0],
        [0.5, 0.5],
      ],
      color: '#123456',
      width: 0.008,
    }
    drawStrokeOn(ctx as never, stroke as never, 200, 200)
    expect(calls).toEqual(['beginPath', 'moveTo(0,0)', 'lineTo(100,100)', 'stroke'])
    expect(ctx.strokeStyle).toBe('#123456')
    expect(ctx.lineWidth).toBe(1.6) // 0.008 × 200（1px 下限那条在上一组用例里）
  })
})

describe('strokeHitByPoint（橡皮擦命中）', () => {
  const W = 100
  const H = 200
  const line = (points: [number, number][]): AnnoStroke => ({
    color: '#000',
    width: 0.01, // 1% 页宽 = 1px（W=100）
    points,
  })

  it('点落在折线段上/附近算命中——判的是**线段距离**，不是采样点距离', () => {
    // 只有两个端点的一条长横线：中点离两个采样点都很远，仍必须命中
    const s = line([
      [0.1, 0.5],
      [0.9, 0.5],
    ])
    expect(strokeHitByPoint(s, 50, 100, 6, W, H)).toBe(true)
    expect(strokeHitByPoint(s, 50, 130, 6, W, H)).toBe(false)
  })

  it('半径叠加上笔迹自身的一半线宽（粗笔迹边缘也算擦到）', () => {
    const thin = line([
      [0.2, 0.5],
      [0.8, 0.5],
    ])
    const thick: AnnoStroke = { ...thin, width: 0.1 } // 10% 页宽 = 10px
    // 距线 6px：细笔迹擦不到（有效半径 2 + 0.5 = 2.5），粗笔迹擦得到（2 + 5 = 7）
    expect(strokeHitByPoint(thin, 50, 106, 2, W, H)).toBe(false)
    expect(strokeHitByPoint(thick, 50, 106, 2, W, H)).toBe(true)
  })

  it('单点笔迹按点距判（点一下留下的那种）', () => {
    const dot = line([[0.5, 0.5]])
    expect(strokeHitByPoint(dot, 51, 101, 3, W, H)).toBe(true)
    expect(strokeHitByPoint(dot, 70, 100, 3, W, H)).toBe(false)
  })

  it('空笔迹不算命中（历史数据里可能有）', () => {
    expect(strokeHitByPoint(line([]), 10, 10, 20, W, H)).toBe(false)
  })
})
