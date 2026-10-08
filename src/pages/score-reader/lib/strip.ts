import { clamp } from './geometry'

/**
 * 上下滚动模式（`ud`）的竖条几何：第 N 页顶边在 `(N-1) × 页高`，**页与页零间隔**。
 *
 * 为什么单独成模块：这几个式子同时被渲染（画布摆放）、手势（滚动到哪里算第几页）、
 * 批注（一笔落在哪一页）三处用，各写一份必然漂移。它们都是纯函数，单测钉住。
 *
 * 「页高」统一取**当前页**的实测高度（同一份谱子的扫描页尺寸一致）；真遇到逐页不同高的
 * 谱子，页间会有一处小接缝——换成逐页累积的话，滚动位置会在新页加载完时跳动，不划算。
 */

/** 竖条总高 */
export function stripHeight(pageH: number, pageCount: number): number {
  return Math.max(0, pageH) * Math.max(0, pageCount)
}

/** 第 page 页（1 起）的顶边在条内的偏移 */
export function pageTop(page: number, pageH: number): number {
  return Math.max(0, page - 1) * Math.max(0, pageH)
}

/**
 * 视口顶边落在条内 `scroll` 处时，**最靠上那一页**是第几页。
 * `scroll` = −pan.y（内容往上移 = 往下滚）。越界的滚动位置钳进 [1, pageCount]。
 */
export function pageFromScroll(scroll: number, pageH: number, pageCount: number): number {
  if (!(pageH > 0) || pageCount <= 0) return 1
  return clamp(Math.floor(Math.max(0, scroll) / pageH) + 1, 1, pageCount)
}

/**
 * 视口里**还没渲染出来**的页（给它们画加载圆圈，用户 2026-10-09 定）。
 *
 * - `scroll`：视口顶边在条内的位置（= −pan.y；左右模式传「当前页的页首」即可，退化成只看这一页）；
 * - `viewportH`：视口高（左右模式传页高 ⇒ 只判当前页）；
 * - `rendered`：已经有画布放着内容的页（作者：`layerSlot` 的值集合）。
 *
 * 这些页是「用户看得见、但还没有内容」——空白与「这页本来就白」在屏幕上分不开，
 * 所以给它一个明确在加载的信号，而不是让他以为卡住了。
 */
export function pendingPages(
  scroll: number,
  pageH: number,
  viewportH: number,
  pageCount: number,
  rendered: ReadonlySet<number>
): number[] {
  const range = visibleRange(scroll, pageH, viewportH, pageCount)
  if (!range) return []
  const out: number[] = []
  for (let p = range.first; p <= range.last; p += 1) if (!rendered.has(p)) out.push(p)
  return out
}

/**
 * 竖条模式下「该立刻排渲染」的那一页（null = 不用排）。
 *
 * 判据：视口里看得见、还没有帧（`pending`，见 `pendingPages`）。方向决定取哪一端：
 * - 往下滚（`dir = 1`）：滚进来的是**最靠下**的那一页，它是用户的下一眼；
 * - 往上滚 / 方向未知：取**最靠上**的那一页。
 *
 * 为什么要单独一条通路而不是靠预绘制：滚动期间每一次页码变化都会占住渲染队列，
 * `predrawGo` 因此整段返回 skip **且不重排**——手指按着屏幕的整段时间里预绘制等于停摆，
 * 而 UD 视口高 ≈ 1.4 页（`pageH` 是内容高，容器还更高），下一页的顶边从一进来就露在
 * 屏幕上，于是「n 画好了、n+1 一直空白」要挂到手指停下 300ms 后（真机反馈 2026-10-09）。
 */
export function nextVisibleToRender(pending: readonly number[], dir: 1 | -1 | 0): number | null {
  // 调用方保证这些页**都不在忙队列里**（见 index.tsx 的守卫：队列空着才补）——
  // 所以这里不需要再过滤，多一个「忙页」参数只会是恒空的死参数。
  if (pending.length === 0) return null
  return dir === 1 ? pending[pending.length - 1] : pending[0]
}

/**
 * 视口盖到哪几页（闭区间，钳进 [1, pageCount]）。`pendingPages` 与「哪几块画布可以动」
 * 都吃它——两处必须是**同一个**判据，否则会出现「看得见的页被判成视野外」这种自相矛盾。
 * 非法的页高/页数返回 null。
 */
export function visibleRange(
  scroll: number,
  pageH: number,
  viewportH: number,
  pageCount: number
): { first: number; last: number } | null {
  if (!(pageH > 0) || pageCount <= 0) return null
  const top = Math.max(0, scroll)
  return {
    first: clamp(Math.floor(top / pageH) + 1, 1, pageCount),
    last: clamp(Math.floor((top + Math.max(0, viewportH) - 1) / pageH) + 1, 1, pageCount),
  }
}
