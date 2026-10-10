import type { AnnoStroke } from '@/lib/annotation'
import type { CanvasCtx } from './types'

/**
 * 批注笔迹的绘制。笔迹坐标是**归一化**的（0~1，相对页面内框），落到画布时按
 * 画布当前像素尺寸换算——这样同一份笔迹在任意缩放/像素比下都能对上位置。
 */

/**
 * 线宽 / 颜色 / 不透明度。
 *
 * ⚠️ `globalAlpha` **每次都要显式写**（不写就沿用上一次的值）。荧光笔的不透明度是画在
 * 批注层这块**透明画布**上的：它与谱面（下面那块画布）之间是普通的 alpha 合成，
 * 于是纸色照样透出来 —— 那就是荧光笔的样子，不需要 `globalCompositeOperation`。
 */
export function styleFor(
  ctx: CanvasCtx,
  color: string,
  width: number,
  w: number,
  alpha = 1
): void {
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1, width * w)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.globalAlpha = alpha
}

/** 归一化点序列 → 画布像素折线 */
export function drawPolylineOn(
  ctx: CanvasCtx,
  pts: [number, number][],
  color: string,
  width: number,
  w: number,
  h: number,
  alpha = 1
): void {
  if (pts.length === 0) return
  styleFor(ctx, color, width, w, alpha)
  ctx.beginPath()
  pts.forEach(([x, y], i) => {
    const px = x * w
    const py = y * h
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  })
  ctx.stroke()
}

export function drawStrokeOn(ctx: CanvasCtx, stroke: AnnoStroke, w: number, h: number): void {
  drawPolylineOn(ctx, stroke.points, stroke.color, stroke.width, w, h, stroke.alpha ?? 1)
}

/**
 * 橡皮擦的命中判定：这一笔有没有被 (px, py) 这个点擦到（都在**画布像素**坐标系里）。
 *
 * 判据是「点到折线段的距离 ≤ 半径」，而不是「点到某个采样点」——笔迹点之间可能隔得很远
 * （快速划过的长直线往往只有两三个点），按点判会整段漏擦，用户就得来回蹭。
 * 半径还要叠加笔迹本身的一半线宽：粗笔迹的边缘也该算被擦到。
 */
export function strokeHitByPoint(
  stroke: AnnoStroke,
  px: number,
  py: number,
  radius: number,
  w: number,
  h: number
): boolean {
  const pts = stroke.points
  if (pts.length === 0) return false
  const r = radius + Math.max(1, stroke.width * w) / 2
  const x0 = pts[0][0] * w
  const y0 = pts[0][1] * h
  if (pts.length === 1) return Math.hypot(px - x0, py - y0) <= r
  for (let i = 1; i < pts.length; i += 1) {
    const x1 = pts[i][0] * w
    const y1 = pts[i][1] * h
    if (distToSegment(px, py, x0, y0, x1, y1) <= r) return true
  }
  return false
}

/**
 * 一串触点扫过的笔迹删除：命中**任一**触点即整条删掉（并集），返回剩下的笔迹。
 *
 * ⚠️ 触点必须**成组**一次过滤。若逐点各调一次 `strokeHitByPoint` 再串行改数据，每次改都
 * 从同一份输入算出 next ⇒ 后一次把前一次的结果盖掉，最后只剩最后一个触点的效果。
 * 橡皮擦落笔时画布 rect 要异步取，等待期间攒下的触点就得这样成组补擦（见 index.tsx 的 beginErase）。
 *
 * `points` 已是**画布像素**坐标（client 坐标减画布 rect，换算在调用方）。
 */
export function eraseStrokesAt(
  strokes: AnnoStroke[],
  points: Array<{ x: number; y: number }>,
  radius: number,
  w: number,
  h: number
): AnnoStroke[] {
  if (points.length === 0) return strokes
  return strokes.filter((s) => !points.some((p) => strokeHitByPoint(s, p.x, p.y, radius, w, h)))
}

/** 点到线段的距离（两端点都退化成一个点时就是点距） */
function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 <= 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
