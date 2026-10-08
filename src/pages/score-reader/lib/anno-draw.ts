import type { AnnoStroke } from '@/lib/annotation'
import type { CanvasCtx } from './types'

/**
 * 批注笔迹的绘制。笔迹坐标是**归一化**的（0~1，相对页面内框），落到画布时按
 * 画布当前像素尺寸换算——这样同一份笔迹在任意缩放/像素比下都能对上位置。
 */

export function styleFor(ctx: CanvasCtx, color: string, width: number, w: number): void {
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1, width * w)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}

/** 归一化点序列 → 画布像素折线 */
export function drawPolylineOn(
  ctx: CanvasCtx,
  pts: [number, number][],
  color: string,
  width: number,
  w: number,
  h: number
): void {
  if (pts.length === 0) return
  styleFor(ctx, color, width, w)
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
  drawPolylineOn(ctx, stroke.points, stroke.color, stroke.width, w, h)
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
