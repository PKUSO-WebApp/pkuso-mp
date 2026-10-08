import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPageTurn, turnDirFor, TURN_MS, type TurnFrame } from './page-turn'

/** 默认的停靠余量（与实现里的 settlePaddingMs 对应） */
const PAD = 40

describe('createPageTurn', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const setup = () => {
    vi.useFakeTimers()
    const seen: Array<TurnFrame | null> = []
    const turn = createPageTurn({ onChange: (f) => seen.push(f) })
    return { turn, seen }
  }

  it('begin 后进入滑出态，走完时长自动停靠', () => {
    const { turn, seen } = setup()
    expect(turn.frame()).toBeNull()
    turn.begin('a', -1)
    expect(turn.frame()).toEqual({ layer: 'a', dir: -1 })
    expect(seen).toEqual([{ layer: 'a', dir: -1 }])
    vi.advanceTimersByTime(TURN_MS + PAD - 1)
    expect(turn.frame()).not.toBeNull() // 还差一拍：仍在滑
    vi.advanceTimersByTime(1)
    expect(turn.frame()).toBeNull()
    expect(seen).toEqual([{ layer: 'a', dir: -1 }, null])
  })

  it('settle：滑的那一块等停靠，另一块立刻放行', async () => {
    const { turn } = setup()
    turn.begin('b', 1)
    const freed: string[] = []
    void turn.settle('b').then(() => freed.push('b'))
    void turn.settle('a').then(() => freed.push('a'))
    await Promise.resolve()
    expect(freed).toEqual(['a']) // 滑的是 b，写 a 不会撞车
    vi.advanceTimersByTime(TURN_MS + PAD)
    await Promise.resolve()
    expect(freed).toEqual(['a', 'b'])
  })

  it('没有动画时 settle 立刻放行', async () => {
    const { turn } = setup()
    await expect(turn.settle('a')).resolves.toBeUndefined()
    turn.begin('a', -1)
    vi.advanceTimersByTime(TURN_MS + PAD)
    await expect(turn.settle('a')).resolves.toBeUndefined() // 停靠后不欠账
  })

  it('连翻：上一段立刻收尾，不留两块同时在滑', () => {
    const { turn, seen } = setup()
    turn.begin('a', -1)
    vi.advanceTimersByTime(100)
    turn.begin('b', -1) // 还没停靠就换了帧
    expect(turn.frame()).toEqual({ layer: 'b', dir: -1 })
    expect(seen).toEqual([{ layer: 'a', dir: -1 }, null, { layer: 'b', dir: -1 }])
  })

  it('stop：清掉计时器，也不再唤醒等待者', async () => {
    const { turn, seen } = setup()
    turn.begin('a', -1)
    let freed = false
    void turn.settle('a').then(() => {
      freed = true
    })
    turn.stop()
    turn.begin('b', 1) // 停之后来的换帧：不再起动画
    expect(turn.frame()).toBeNull()
    vi.advanceTimersByTime(TURN_MS * 10)
    await Promise.resolve()
    expect(seen).toEqual([{ layer: 'a', dir: -1 }]) // 页面已销毁：不再回调
    expect(freed).toBe(false) // 等待者就此停住（醒来会去动已销毁的画布）
  })
})

describe('turnDirFor', () => {
  it('往后翻向左滑（-1），往回翻向右滑（1）', () => {
    expect(turnDirFor({ firstPaint: false, shown: 3, target: 4 })).toBe(-1)
    expect(turnDirFor({ firstPaint: false, shown: 3, target: 2 })).toBe(1)
    expect(turnDirFor({ firstPaint: false, shown: 3, target: 20 })).toBe(-1) // 跳页也按方向
  })

  it('首帧不滑：没有旧页可滑', () => {
    expect(turnDirFor({ firstPaint: true, shown: 0, target: 1 })).toBeNull()
    expect(turnDirFor({ firstPaint: true, shown: 0, target: 7 })).toBeNull()
  })

  it('同一页的重渲不滑（缩放 / 转屏）', () => {
    expect(turnDirFor({ firstPaint: false, shown: 7, target: 7 })).toBeNull()
  })

  it('还没显示过任何一页时不滑（换册后的首帧）', () => {
    expect(turnDirFor({ firstPaint: false, shown: 0, target: 5 })).toBeNull()
  })

  it('首帧标记优先：即使页码看着像翻页也不滑', () => {
    expect(turnDirFor({ firstPaint: true, shown: 3, target: 4 })).toBeNull()
  })
})
