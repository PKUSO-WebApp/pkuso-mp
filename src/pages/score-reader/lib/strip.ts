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
 * 把一笔（条内坐标点，见下）按页切开。
 *
 * 点的形状：`[x, py]`——x 是**按宽度归一化**的横坐标（0~1，与左右模式同一套），
 * `py` 是**页坐标**：整数部分是「第几页 − 1」，小数部分是页内归一化纵坐标。
 * 所以 `py = 2.4` 表示「第 3 页 40% 处」。左右模式里 py 恒在 [0,1)，切出来就是一笔。
 *
 * 跨页的那一笔在交界处切成两笔，各自记到各自的页上（批注本来就是按页存的）。
 * 落在条两端之外的点钳进 [0, pageCount]。
 */
export function splitStrokeByStrip(
  points: readonly [number, number][],
  pageCount: number
): Array<{ page: number; points: [number, number][] }> {
  if (points.length === 0 || pageCount <= 0) return []
  const maxPy = Math.max(1, pageCount)
  // 4 位小数就够（1e-4 页宽 ≈ 亚像素）：既抹掉 `2.2 - 2 = 0.20000000000000018` 这类
  // 浮点尾巴，也让落盘的笔迹小一截
  const tidy = (v: number): number => Math.round(v * 1e4) / 1e4
  const runs: Array<{ page: number; points: [number, number][] }> = []
  for (const [x, rawPy] of points) {
    const py = clamp(rawPy, 0, maxPy)
    // py === pageCount（正好落在最后一条底边上）算最后一页的页尾，不能算成第 pageCount+1 页
    const idx = Math.min(pageCount - 1, Math.floor(py >= maxPy ? pageCount - 1 : py))
    const local = tidy(clamp(py - idx, 0, 1))
    const px = tidy(x)
    const last = runs[runs.length - 1]
    if (last && last.page === idx + 1) last.points.push([px, local])
    else runs.push({ page: idx + 1, points: [[px, local]] })
  }
  return runs
}
