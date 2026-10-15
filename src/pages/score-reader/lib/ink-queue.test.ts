import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInkQueue, INK_COALESCE_MS } from './ink-queue'

/** 假时钟 + 假定时器：合帧的语义（哪一拍画、哪一拍不画）只有可控时间才测得出来 */
function setup(frameMs = INK_COALESCE_MS) {
  let now = 0
  const timers: Array<{ at: number; fn: () => void; id: number }> = []
  let nextId = 1
  const paint = vi.fn()

  const q = createInkQueue({
    paint,
    frameMs,
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++
      timers.push({ at: now + ms, fn, id })
      return id
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h)
      if (i >= 0) timers.splice(i, 1)
    },
  })

  /** 推进到某个时刻，并把到点的定时器都跑掉 */
  const advance = (ms: number) => {
    now += ms
    for (const t of timers.filter((x) => x.at <= now)) {
      const i = timers.indexOf(t)
      if (i >= 0) timers.splice(i, 1)
      t.fn()
    }
  }

  return { q, paint, advance, pendingTimers: () => timers.length }
}

describe('createInkQueue（实时笔迹的重画合帧）', () => {
  let s: ReturnType<typeof setup>
  beforeEach(() => {
    s = setup()
  })

  it('第一下立刻画（起手必须跟手，不能先等一帧）', () => {
    s.q.request()
    expect(s.paint).toHaveBeenCalledTimes(1)
  })

  it('⚠️ 一帧内的后续请求被合并 —— 只画一次，但点由调用方照旧全存', () => {
    s.q.request() // 第一下：立刻
    s.q.request()
    s.q.request()
    s.q.request()
    expect(s.paint).toHaveBeenCalledTimes(1) // 那三下并成一次
    s.advance(INK_COALESCE_MS) // 到点：补画一次（画的是最新数据）
    expect(s.paint).toHaveBeenCalledTimes(2)
  })

  it('过了窗口再请求 ⇒ 立刻画（不必再等）', () => {
    s.q.request()
    s.advance(INK_COALESCE_MS)
    s.q.request()
    expect(s.paint).toHaveBeenCalledTimes(2)
  })

  it('flush 立刻把待画的那一帧画掉（抬手前补最后一拍）', () => {
    s.q.request() // 立刻
    s.q.request() // 并入下一帧
    expect(s.paint).toHaveBeenCalledTimes(1)
    s.q.flush()
    expect(s.paint).toHaveBeenCalledTimes(2)
    s.advance(INK_COALESCE_MS * 3) // 定时器已被清掉，不会再多画
    expect(s.paint).toHaveBeenCalledTimes(2)
  })

  it('⚠️ cancel 之后那一帧**不会**再画（即将落定时必须调，否则会用清空后的点重画）', () => {
    s.q.request()
    s.q.request()
    s.q.cancel()
    s.advance(INK_COALESCE_MS * 3)
    expect(s.paint).toHaveBeenCalledTimes(1) // 只有第一下那次
  })

  it('cancel 之后再 request 照常工作（不是一次性的）', () => {
    s.q.request()
    s.q.request()
    s.q.cancel()
    s.advance(INK_COALESCE_MS * 3)
    s.q.request()
    expect(s.paint).toHaveBeenCalledTimes(2)
  })

  it('没有待画帧时 flush 什么都不做（不会凭空多画一次）', () => {
    s.q.request()
    s.q.flush()
    expect(s.paint).toHaveBeenCalledTimes(1)
  })

  it('窗口为 0 时每个请求都立刻画（等价于不合帧）', () => {
    const z = setup(0)
    z.q.request()
    z.q.request()
    z.q.request()
    expect(z.paint).toHaveBeenCalledTimes(3)
    expect(z.pendingTimers()).toBe(0)
  })
})
