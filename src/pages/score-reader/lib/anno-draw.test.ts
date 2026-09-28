import { describe, expect, it } from 'vitest'
import { drawPolylineOn, drawStrokeOn } from './anno-draw'

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
