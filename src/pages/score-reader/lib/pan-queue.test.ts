import { describe, expect, it } from 'vitest'
import { createPanQueue, PAN_COALESCE_MS } from './pan-queue'
import type { Pan } from './types'

/**
 * 假时钟 + 假定时器：同一时刻只可能排着一个回调（这正是不变量），
 * `advance` 走到点就把它跑掉。用注入的时钟而不是 vi.useFakeTimers：
 * 判据里要断言「什么时候落地」，时钟与调度都得看得见。
 */
function harness(frameMs: number = PAN_COALESCE_MS) {
  let t = 0
  let due: { at: number; fn: () => void } | null = null
  const commits: Pan[] = []
  const q = createPanQueue({
    commit: (p) => commits.push(p),
    frameMs,
    now: () => t,
    setTimer: (fn, ms) => {
      due = { at: t + ms, fn }
      return 1
    },
    clearTimer: () => {
      due = null
    },
  })
  return {
    q,
    commits,
    advance(ms: number) {
      t += ms
      if (due && t >= due.at) {
        const fn = due.fn
        due = null
        fn()
      }
    },
    /** 还有没有排着的定时器（断言「不该留尾巴」用） */
    hasTimer: () => due !== null,
  }
}

const p = (x: number): Pan => ({ x, y: 0 })

describe('createPanQueue（手势平移的合帧）', () => {
  it('第一下立刻落地——起手必须跟手，不能先等一帧', () => {
    const h = harness()
    h.q.push(p(1))
    expect(h.commits).toEqual([p(1)])
    expect(h.hasTimer()).toBe(false) // 落地了就不该再留定时器
  })

  it('一帧窗口内的连推只落地最新那一个，且只落地一次', () => {
    const h = harness()
    h.q.push(p(1)) // 立刻落地
    h.q.push(p(2))
    h.q.push(p(3))
    h.q.push(p(4))
    expect(h.commits).toEqual([p(1)]) // 中间值一个都不落地
    h.advance(PAN_COALESCE_MS)
    expect(h.commits).toEqual([p(1), p(4)]) // 到点只补最新
  })

  it('落地之后立刻再推仍要等下一拍——速率上限是「每次落地间隔 ≥ 一帧」', () => {
    const h = harness()
    h.q.push(p(1))
    h.advance(PAN_COALESCE_MS) // 空转一帧
    h.q.push(p(2)) // 距上次落地正好一帧 ⇒ 立刻落地
    expect(h.commits).toEqual([p(1), p(2)])
    h.q.push(p(3)) // 紧接着的这一推：排队
    expect(h.commits).toEqual([p(1), p(2)])
    h.advance(PAN_COALESCE_MS)
    expect(h.commits).toEqual([p(1), p(2), p(3)])
  })

  it('空闲超过一帧后的推立刻落地（不积压）', () => {
    const h = harness()
    h.q.push(p(1))
    h.advance(200)
    h.q.push(p(2))
    expect(h.commits).toEqual([p(1), p(2)])
  })

  it('flush 把待落地的补上（抬手用），没有待落地的值时什么都不做', () => {
    const h = harness()
    h.q.push(p(1))
    h.q.push(p(2)) // 排队中
    h.q.flush()
    expect(h.commits).toEqual([p(1), p(2)])
    expect(h.hasTimer()).toBe(false)
    h.q.flush() // 已经空了：不加戏
    expect(h.commits).toEqual([p(1), p(2)])
  })

  it('cancel 丢弃待落地的值，且定时器一起撤掉（回滚/换册前用）', () => {
    const h = harness()
    h.q.push(p(1))
    h.q.push(p(2))
    h.q.cancel()
    expect(h.commits).toEqual([p(1)])
    expect(h.hasTimer()).toBe(false)
    h.advance(500) // 撤掉的定时器不会再回来
    expect(h.commits).toEqual([p(1)])
  })

  it('cancel 之后队列还能用：新值照常排队、到点落地', () => {
    const h = harness()
    h.q.push(p(1))
    h.q.push(p(2))
    h.q.cancel()
    h.q.push(p(3)) // 仍在同一帧窗口内 ⇒ 排队
    expect(h.commits).toEqual([p(1)])
    h.advance(PAN_COALESCE_MS)
    expect(h.commits).toEqual([p(1), p(3)])
  })

  it('frameMs = 0 退化成「每次都落地」（这个旋钮就是留给真机再调的）', () => {
    const h = harness(0)
    h.q.push(p(1))
    h.q.push(p(2))
    h.q.push(p(3))
    expect(h.commits).toEqual([p(1), p(2), p(3)])
  })
})
