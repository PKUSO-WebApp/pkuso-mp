import { describe, expect, it } from 'vitest'
import { waitForLayoutSize, type CanvasSize } from './canvas-size'

/** 不进事件循环的 tick：用例里等待是纯逻辑，不需要真的等 16ms */
const noTick = (): Promise<void> => Promise.resolve()

/** 按序返回给定尺寸的探针；用完之后一直返回最后一个 */
function probeOf(seq: Array<CanvasSize | null>): { probe: () => Promise<CanvasSize | null>; calls: () => number } {
  let i = 0
  let calls = 0
  return {
    probe: async () => {
      calls += 1
      const v = seq[Math.min(i, seq.length - 1)]
      i += 1
      return v
    },
    calls: () => calls,
  }
}

describe('waitForLayoutSize', () => {
  it('第一次查就已经到位 ⇒ 返回 0，不再多查也不等', async () => {
    const { probe, calls } = probeOf([{ width: 390, height: 533 }])
    const ticks: number[] = []
    const n = await waitForLayoutSize(probe, { width: 390, height: 533 }, {
      tick: async () => {
        ticks.push(1)
      },
    })
    expect(n).toBe(0)
    expect(calls()).toBe(1)
    expect(ticks).toEqual([])
  })

  it('等两拍才到位 ⇒ 返回 2（真机首帧的形态：布局盒先是 0 高）', async () => {
    const { probe } = probeOf([
      { width: 390, height: 0 },
      { width: 390, height: 0 },
      { width: 390, height: 533 },
    ])
    expect(await waitForLayoutSize(probe, { width: 390, height: 533 }, { tick: noTick })).toBe(2)
  })

  it('±1px 以内算到位（rpx 换算与舍入的余量）', async () => {
    const { probe } = probeOf([{ width: 389, height: 534 }])
    expect(await waitForLayoutSize(probe, { width: 390, height: 533 }, { tick: noTick })).toBe(0)
  })

  it('一直不到位 ⇒ 拍到上限返回 -1（调用方照画不误，绝不能因为等不到就不上屏）', async () => {
    const { probe, calls } = probeOf([{ width: 390, height: 0 }])
    expect(await waitForLayoutSize(probe, { width: 390, height: 533 }, { tries: 3, tick: noTick })).toBe(-1)
    expect(calls()).toBe(3)
  })

  it('查不到（null）不算到位，继续等', async () => {
    const { probe } = probeOf([null, null, { width: 390, height: 533 }])
    expect(await waitForLayoutSize(probe, { width: 390, height: 533 }, { tick: noTick })).toBe(2)
  })

  it('宽对高不对也算没到位（首帧坏的就是高度这一维）', async () => {
    const { probe } = probeOf([{ width: 390, height: 0 }, { width: 390, height: 533 }])
    expect(await waitForLayoutSize(probe, { width: 390, height: 533 }, { tick: noTick })).toBe(1)
  })
})
