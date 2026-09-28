import type { Pan } from './types'

/** 视口内几何：平移钳制与双指手势的取距/取中点（纯函数，无 Taro 依赖） */

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/** 内容框位置钳制：比视口小的一轴居中，比视口大的一轴不拉出空白 */
export function clampPan(p: Pan, w: number, h: number, vw: number, vh: number): Pan {
  if (vw <= 0 || vh <= 0) return p
  const x = w <= vw ? (vw - w) / 2 : clamp(p.x, vw - w, 0)
  const y = h <= vh ? (vh - h) / 2 : clamp(p.y, vh - h, 0)
  return x === p.x && y === p.y ? p : { x, y }
}

export function touchDist(touches: { clientX: number; clientY: number }[]): number {
  const [a, b] = touches
  if (!a || !b) return 0
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

export function touchMid(touches: { clientX: number; clientY: number }[]): [number, number] {
  const [a, b] = touches
  if (!a || !b) return [0, 0]
  return [(a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2]
}
