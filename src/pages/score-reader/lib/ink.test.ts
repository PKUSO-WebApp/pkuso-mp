import { describe, expect, it } from 'vitest'
import type { AnnoStroke } from '@/lib/annotation'
import { inkFor, type LiveInk } from './ink'

const stroke = (x: number, color = '#e5484d'): AnnoStroke => ({
  color,
  width: 0.004,
  points: [
    [x, 0.5],
    [x + 0.1, 0.5],
  ],
})

const live = (x: number, alpha: number | undefined = undefined): LiveInk => ({
  points: [
    [x, 0.3],
    [x + 0.1, 0.3],
  ],
  color: '#2f6fed',
  width: 0.008,
  alpha,
})

describe('inkFor（这一页此刻该画什么）', () => {
  it('没有正在画的那一笔时原样返回', () => {
    const a = stroke(0.1)
    expect(inkFor([a], null)).toEqual([a])
  })

  it('live 一个点都没有 ⇒ 不参与（画不出东西，也不该占位）', () => {
    const a = stroke(0.1)
    expect(inkFor([a], { ...live(0.5), points: [] })).toEqual([a])
  })

  it('已落定的在前、正在画的在后（后画的在上层）', () => {
    const a = stroke(0.1)
    const out = inkFor([a], live(0.5))
    expect(out).toHaveLength(2)
    expect(out[0]).toBe(a)
    expect(out[1].points).toEqual(live(0.5).points)
  })

  it('live 的颜色 / 线宽原样带过去', () => {
    const out = inkFor([], live(0.5))
    expect(out[0].color).toBe('#2f6fed')
    expect(out[0].width).toBe(0.008)
  })

  it('⚠️ 画笔的 alpha 是 `undefined` 而不是 1 —— 与落定时的写法一致', () => {
    // 这条不是吹毛求疵：两边写法不一致时，「画着的时候」与「松手之后」会是两个样子，
    // 而那正是 2026-10-10 引入「整条重画」的起因（见 index.tsx 里 repaintLiveStroke）
    const drawn = inkFor([], live(0.5))[0]
    const committed: AnnoStroke = {
      color: '#2f6fed',
      width: 0.008,
      points: live(0.5).points,
      alpha: undefined,
    }
    expect(drawn).toEqual(committed)
    expect(drawn.alpha).toBeUndefined() // 读侧按 `?? 1` 兜底
    expect(drawn.alpha ?? 1).toBe(1)
  })

  it('荧光笔的 alpha 原样带过去', () => {
    expect(inkFor([], live(0.5, 0.5))[0].alpha).toBe(0.5)
  })

  it('空页 + 没有 live ⇒ 空（不该凭空造出一笔）', () => {
    expect(inkFor([], null)).toEqual([])
  })
})
