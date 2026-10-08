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
  if (!(pageH > 0) || pageCount <= 0) return []
  const top = Math.max(0, scroll)
  const first = clamp(Math.floor(top / pageH) + 1, 1, pageCount)
  const last = clamp(Math.floor((top + Math.max(0, viewportH) - 1) / pageH) + 1, 1, pageCount)
  const out: number[] = []
  for (let p = first; p <= last; p += 1) if (!rendered.has(p)) out.push(p)
  return out
}
