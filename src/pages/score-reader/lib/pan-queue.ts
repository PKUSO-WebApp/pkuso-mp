import type { Pan } from './types'

/**
 * 平移的**合帧队列**：手势期间落地最多每 `PAN_COALESCE_MS` 一次，窗口内只保留最新值。
 *
 * 为什么要有它（2026-10-09 iOS 真机反馈：「一次长滑没问题，多次小幅度滑动一顿一顿」）：
 * 一次 touchmove 就是一次「视图层 → 逻辑层 → setData → 视图层」（官方文档点名的慢链路，
 * movable-view / WXS / Worklet 都是为绕开它而存在）。iOS 的触摸事件几乎按屏幕刷新率直通
 * （ProMotion 机型更密），60~120 次/秒的 setData 会把这条链路压满——更新永远排在手指后面，
 * 抬手之后才补上。位移大时这只是「有点重」，位移小时就是肉眼可见的一顿一顿。
 * 合帧把落地速率钉在一帧一次，位置永远取最新，手感只差一帧（首帧仍是立刻落地）。
 *
 * 三条语义，改的时候别丢：
 * 1. **首帧立刻落地**：起手第一下必须跟手，不能先等一帧；
 * 2. **窗口内只留最新**：中间值会被下一帧覆盖，丢掉它们正是省下来的开销；
 * 3. **flush() 补最后一拍**：抬手 / 换手势基准前必须把待落地的值落地，
 *    否则「手指停了，画面还差一截」；而下一段手势的基准若读的是没落地的旧值，
 *    起手就会先往回跳一下。
 *
 * 时钟与定时器可注入（单测用假的），生产直接用 Date.now / setTimeout。
 */

/** 合帧窗口（毫秒），≈ 一帧 @60Hz。真机上还要再调就是这个数 */
export const PAN_COALESCE_MS = 16

export type PanQueue = {
  /** 记一个目标位置：距上次落地已过一帧就立刻落地，否则只留最新、到点再落地 */
  push(p: Pan): void
  /** 立刻落地待落地的那个值（没有则什么都不做） */
  flush(): void
  /** 丢弃待落地的值（回滚 / 换册这类「以我为准」的写入之前调用） */
  cancel(): void
}

export function createPanQueue(opts: {
  commit: (p: Pan) => void
  frameMs?: number
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
}): PanQueue {
  const frameMs = Math.max(0, opts.frameMs ?? PAN_COALESCE_MS)
  const now = opts.now ?? Date.now
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))

  /** 上一次落地时刻；-Infinity = 还没有过 ⇒ 第一下立刻落地 */
  let landedAt = Number.NEGATIVE_INFINITY
  let pending: Pan | null = null
  let timer: unknown = null

  const land = (p: Pan): void => {
    landedAt = now()
    opts.commit(p)
  }

  return {
    push(p) {
      if (now() - landedAt >= frameMs) {
        // 上一帧已经过去：立刻落地（跟手），并把窗口重新开起来
        if (timer !== null) {
          clearTimer(timer)
          timer = null
        }
        pending = null
        land(p)
        return
      }
      pending = p
      if (timer !== null) return
      timer = setTimer(() => {
        timer = null
        const v = pending
        pending = null
        if (v) land(v)
      }, frameMs)
    },
    flush() {
      if (timer !== null) {
        clearTimer(timer)
        timer = null
      }
      const v = pending
      pending = null
      if (v) land(v)
    },
    cancel() {
      if (timer !== null) {
        clearTimer(timer)
        timer = null
      }
      pending = null
    },
  }
}
