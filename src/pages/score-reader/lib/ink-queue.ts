/**
 * 实时笔迹的**重画合帧**。形状与 `pan-queue` 同源，但有一条关键差别：
 *
 * > **点一个都不能丢** —— 合的是「重画」这个动作，不是点。
 *
 * 平移只要最终位置，所以窗口内的中间值可以扔；笔迹不行：触控笔 120~240Hz，比帧还密，
 * 而每个触点都清屏重画一整页（见 `paintInkOn`）会把 JS 一直占着 ⇒ 这期间到达的
 * `touchmove` 被系统丢掉 ⇒ **卡顿前后的两个点被直接连成直线**（用户 2026-10-15 真机：
 * 「原本在画曲线，卡顿前后的手指位置强制拉成直线」）。所以：点由调用方照旧每个都入账
 * （`strokePtsRef.push`），这里只把重画压到每帧最多一次 —— JS 的占用于是与事件频率解耦。
 *
 * `paint` 回调应当**读最新数据重画**（阅读器里就是读 `strokePtsRef.current`），
 * 所以「窗口内只画一次」不会丢内容：那一次画的是最新的一整条。
 *
 * 三条语义（照抄 pan-queue，改的时候别丢）：
 * 1. **首帧立刻画**：起手第一下必须跟手，不能先等一帧；
 * 2. **窗口内只画一次**：中间那些请求被合并掉 —— 省下来的就是 JS 时间；
 * 3. **`flush()` 补最后一拍**、`cancel()` 丢弃待画的那一帧：抬手 / 作废这一笔之前必须调，
 *    否则 16ms 后它还会用**已经清空**的点重画一遍（那一拍画出来的东西是错的）。
 *
 * 时钟与定时器可注入（单测用假的），生产直接用 `Date.now` / `setTimeout`。
 */

/** 合帧窗口（毫秒），≈ 一帧 @60Hz。真机上还要再调就是这个数 */
export const INK_COALESCE_MS = 16

export type InkQueue = {
  /** 请求一次重画：距上次已过一帧就立刻画，否则并到下一帧（那一帧画的是最新数据） */
  request(): void
  /** 立刻把待画的那一帧画掉 */
  flush(): void
  /** 丢弃待画的那一帧（这一笔要作废 / 即将落定时用） */
  cancel(): void
}

export function createInkQueue(opts: {
  paint: () => void
  frameMs?: number
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
}): InkQueue {
  const frameMs = Math.max(0, opts.frameMs ?? INK_COALESCE_MS)
  const now = opts.now ?? Date.now
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))

  /** 上一次画的时刻；-Infinity = 还没有过 ⇒ 第一下立刻画 */
  let paintedAt = Number.NEGATIVE_INFINITY
  let pending = false
  let timer: unknown = null

  const paintNow = (): void => {
    paintedAt = now()
    opts.paint()
  }

  const clearTimerOnly = (): void => {
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
  }

  return {
    request() {
      if (now() - paintedAt >= frameMs) {
        // 上一帧已经过去：立刻画（跟手），并把窗口重新开起来
        clearTimerOnly()
        pending = false
        paintNow()
        return
      }
      pending = true
      if (timer !== null) return
      timer = setTimer(() => {
        timer = null
        if (!pending) return
        pending = false
        paintNow()
      }, frameMs)
    },
    flush() {
      clearTimerOnly()
      if (!pending) return
      pending = false
      paintNow()
    },
    cancel() {
      clearTimerOnly()
      pending = false
    },
  }
}
