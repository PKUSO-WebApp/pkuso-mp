import type { CanvasNode } from './types'

/**
 * 位图栅格化与「这一帧到底画出来没有」的探测。
 *
 * 真机上的静默失败是这块最难查的：pdf.js 会 resolve、没有任何报错，而画布上什么都
 * 没有（整页白）。所以渲前先点一个洋红记号，渲完再看它还在不在 / 抽样看有没有墨，
 * 以此区分「空渲染」「没渲染」「这页本来就空白」三种情况——上层据此决定重试还是
 * 重开文档。
 */

export const DPR = 2

/** 位图上限：单边别超 4096、总量别超 12M 像素（约 48MB）——
 *  真机上超限的画布会分配失败/画不出来，表现就是「整页白」 */
export const MAX_RASTER_EDGE = 4096
export const MAX_RASTER_PIXELS = 12000000

/** 画布位图用的像素比：按上限压，超限时宁可软一点也不画不出来 */
export function rasterDpr(cssW: number, cssH: number): number {
  if (cssW <= 0 || cssH <= 0) return DPR
  const edge = Math.min(MAX_RASTER_EDGE / (cssW * DPR), MAX_RASTER_EDGE / (cssH * DPR))
  const area = Math.sqrt(MAX_RASTER_PIXELS / (cssW * cssH * DPR * DPR))
  return Math.min(1, edge, area) * DPR
}

/**
 * 渲前在画布角上点一个洋红记号。渲完记号还在 = 这次渲染**根本没碰这块画布**
 * （否则 pdf.js 的底色填充会把它盖掉）。用来区分「空渲染」和「没渲染」
 */
export function drawMark(node: CanvasNode): void {
  try {
    const ctx = node.getContext('2d')
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#ff00ff'
    ctx.fillRect(0, 0, 4, 4)
  } catch {
    // 记号画不上不影响主流程
  }
}

/** 记号是否还在（还在 = 这次渲染没碰过画布） */
export function markKept(node: CanvasNode): boolean {
  try {
    const d = node.getContext('2d').getImageData(1, 1, 1, 1).data
    return d[0] > 200 && d[1] < 80 && d[2] > 200
  } catch {
    return false
  }
}

/**
 * 抽样看这一帧有没有墨：渲染静默失败（pdf.js resolve 了但一个操作都没落下去）
 * 时整块画布是纯白，这里能看出来。返回 -1 表示探测本身失败，不参与判定。
 */
export function frameInk(node: CanvasNode): number {
  try {
    const ctx = node.getContext('2d')
    if (!ctx?.getImageData) return -1
    const w = node.width
    const h = node.height
    if (!w || !h) return -1
    // 取三条整行（比单点采样可靠得多）：某行存在非白像素就算这行有墨。
    // 返回有几行有墨（0~3），0 表示整帧纯白 —— 就是渲染静默失败的样子
    let inkRows = 0
    for (const fy of [0.25, 0.5, 0.75]) {
      const d = ctx.getImageData(0, Math.floor(fy * h), w, 1).data
      for (let i = 0; i < d.length; i += 4) {
        if (!(d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245)) {
          inkRows++
          break
        }
      }
    }
    return inkRows
  } catch {
    return -1
  }
}
