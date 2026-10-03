import type { Layer } from './types'

/**
 * 翻页动画（滑出揭示）的状态机：旧页滑出去，新页在下面被露出来。
 *
 * 为什么收成一个状态机、而不是把 CSS 动画直接挂上去——两条竞态：
 *
 * 1. **写位图 × 正在滑的那一块**：串行队列的下一件渲染按 `activeLayerRef` 挑反面那块，
 *    换帧后挑中的正是刚退役、还在滑的那一块；而 pdf.js 的 `renderPage` 一上来就
 *    `canvas.width = …`（清屏）⇒ 半路被清，滑行中的旧页当场露白。所以**动位图之前
 *    必须 `settle(layer)` 等它停靠**（那一关在 `index.tsx` 的 doRender 里）。
 * 2. **两块同时在滑**：`begin` 里先 `park()` 收尾上一段。按现在的接线这是防御性的
 *    ——换了帧的那件渲染已经过了上面的关，走到这里上一段必然停了。
 *
 * 连翻不瞬切，是排队等停靠（观感更好，同样不露白）。
 *
 * 真机手感（时长 / 缓动）在这里调；**位移距离不在这里**——它要按内容框宽度算，
 * 见 `index.tsx` 的 `layerStyle`。
 */
export const TURN_MS = 180
/** 起步快、收尾慢：像书页被拨过去 */
export const TURN_EASING = 'ease-out'
/** 停靠计时比过渡多留一拍——计时器先到会看到「滑到一半被拽走」 */
const SETTLE_PADDING_MS = 40

/** 滑出方向：-1 = 向左（往后翻），1 = 向右（往前翻） */
export type TurnDir = -1 | 1

/** 正在滑出的那一块与方向 */
export type TurnFrame = { layer: Layer; dir: TurnDir }

/**
 * 这次换帧要不要滑、往哪滑；null = 不滑（直接切）。
 *
 * 不滑的三类，都是**同一页/没有旧页**的重渲——滑出去再滑回来只会像故障：
 * 首帧（没有旧页可滑）、缩放/转屏/白帧自愈的重渲（`shown === target`）、
 * 换册后的首帧（`shown = 0`，此时换册前后页码可能撞上，不能靠页码区分）。
 */
export function turnDirFor(opts: {
  firstPaint: boolean
  /** 显示中的页；0 = 还没显示过任何一页 */
  shown: number
  target: number
}): TurnDir | null {
  if (opts.firstPaint || opts.shown <= 0 || opts.shown === opts.target) return null
  return opts.target > opts.shown ? -1 : 1
}

export type PageTurn = {
  /** 换帧时调用：让退役的那一块滑出去（上一段若还在滑，立刻收尾） */
  begin(layer: Layer, dir: TurnDir): void
  /** 正在滑出的帧；null = 没有动画 */
  frame(): TurnFrame | null
  /** 等这一块停靠完（不在滑就立刻 resolve）——写它的位图之前必须过这一关 */
  settle(layer: Layer): Promise<void>
  /** 退出页面：清计时器，不唤醒等待者（唤醒它们反而会去动已销毁的画布） */
  stop(): void
}

export function createPageTurn(opts: {
  /** 状态变化回调：组件用它 setState 驱动画布 style */
  onChange: (frame: TurnFrame | null) => void
  durationMs?: number
  settlePaddingMs?: number
}): PageTurn {
  const duration = opts.durationMs ?? TURN_MS
  const padding = opts.settlePaddingMs ?? SETTLE_PADDING_MS
  let frame: TurnFrame | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let waiters: Array<() => void> = []
  let stopped = false

  /** 停靠：这一块回到「随时可写」的状态 */
  const park = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (frame) {
      frame = null
      opts.onChange(null)
    }
    if (waiters.length > 0) {
      const pending = waiters
      waiters = []
      pending.forEach((resolve) => resolve())
    }
  }

  return {
    begin(layer, dir) {
      if (stopped) return // 页面已销毁：别再起计时器、别再 setState
      park()
      frame = { layer, dir }
      opts.onChange(frame)
      timer = setTimeout(park, duration + padding)
    },
    frame: () => frame,
    settle(layer) {
      // 滑的是另一块时不用等：写它不会撞车
      if (!frame || frame.layer !== layer) return Promise.resolve()
      return new Promise<void>((resolve) => waiters.push(resolve))
    },
    stop() {
      stopped = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      frame = null
      waiters = []
    },
  }
}
