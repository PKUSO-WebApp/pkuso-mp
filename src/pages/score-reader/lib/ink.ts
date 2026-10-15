import type { AnnoStroke } from '@/lib/annotation'

/**
 * 「**还没入账的那一笔**」的显式表示。
 *
 * 画布上其实有两种墨：**已落定**的（在 `annos` 里）与**还没入账**的（正在画的那条线、
 * 刚落下的点）。从前只有 `repaintLiveStroke` 知道后者（它有个 `live` 参数），`paintLane`
 * 不知道 —— 于是「谁清屏谁就抹掉别人的」，真机上表现为闪一下
 *（`pkusoweb/批注绘制-结构调查.md` §2-2）。把它变成**显式的值**之后，任何一次重画都能
 * 带上它，不再依赖「调用方记得传」。
 */
export type LiveInk = {
  /** 归一化点（与 `AnnoStroke.points` 同一坐标系） */
  points: [number, number][]
  color: string
  width: number
  /**
   * 荧光笔 0.5；**画笔是 `undefined`**（不是 1）—— 与 `commitStrokePoints` 落定时的写法
   * 逐字一致。两边不一致的话，「画着的时候」与「松手之后」会是两个样子，而那正是
   * 2026-10-10 引入「整条重画」的起因。
   */
  alpha: number | undefined
}

/**
 * **「这一页此刻该画什么」的唯一答案来源。**
 *
 * 已落定的在前、正在画的那一笔在后（后画的在上层）。`live` 没有点时不参与 ——
 * 它画不出东西，也不该占位（空笔迹会参与指纹与包含关系判定，见 annotation.ts 的归一化）。
 */
export function inkFor(strokes: AnnoStroke[], live: LiveInk | null): AnnoStroke[] {
  if (!live || live.points.length === 0) return strokes
  return [
    ...strokes,
    { color: live.color, width: live.width, points: live.points, alpha: live.alpha },
  ]
}
