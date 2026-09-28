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
