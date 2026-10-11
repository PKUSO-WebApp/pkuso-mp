import type { Pan } from './types'

/** 视口内几何：平移钳制与双指手势的取距/取中点（纯函数，无 Taro 依赖） */

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/**
 * 内容框位置钳制：比视口小的一轴居中，比视口大的一轴不拉出空白。
 *
 * `insetTop` / `insetBottom` = **可用视口的上下内缩**（竖条模式传工具条实测高度，见 index.tsx）：
 * 工具条悬浮在谱面之上，内容贴屏幕顶的那一条其实被它盖着——所以「滚到最上」应当停在
 * 「内容顶边对齐工具条下沿」（y = insetTop），而不是对齐屏幕顶。默认 0 = 与从前完全一致。
 */
export function clampPan(
  p: Pan,
  w: number,
  h: number,
  vw: number,
  vh: number,
  insetTop = 0,
  insetBottom = 0
): Pan {
  if (vw <= 0 || vh <= 0) return p
  const x = w <= vw ? (vw - w) / 2 : clamp(p.x, vw - w, 0)
  const usableH = Math.max(0, vh - insetTop - insetBottom)
  const y = h <= usableH ? insetTop + (usableH - h) / 2 : clamp(p.y, vh - insetBottom - h, insetTop)
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
