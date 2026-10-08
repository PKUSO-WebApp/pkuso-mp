import type { CanvasNode } from './types'

/**
 * 位图栅格化与「这一帧到底画出来没有」的探测。
 *
 * 页图是 web 端**预渲染好的整页 JPEG**（不是现渲的），所以这里只剩两件事：
 * - `frameInk`：抽样看一帧有没有墨——预绘制把帧备进备用块之后要过这一关，
 *   空白帧只丢弃、不重试（误丢的代价只是这一页走常规渲染）；
 * - `sampleEdgeColors`：采页边的**纸色**，给上下灰带当填充色。
 *
 * 历史上这里还有一整套「渲前点记号 → 渲后探测 → 重开文档」的白帧自愈，那是为 pdf.js
 * 的**静默失败**（resolve 了却什么都没画）准备的；2026-10-08 拿掉 pdf 运行时之后一并删掉
 * ——页图不存在「渲染失败」这种情况。
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
 * 逐通道取中位数并格式化成 `#rrggbb`（纯函数，单测钉它）。
 *
 * 为什么是中位数而不是均值/某一点：谱面上任何一处都可能有符头、文字或扫描噪点压到
 * 采样点上，中位数对少量离群值免疫，而均值会被一个黑点拖暗。
 */
export function medianHex(samples: ArrayLike<number>[]): string {
  const mid = (vals: number[]): number => {
    const s = [...vals].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)] ?? 0
  }
  const ch = (i: number): number => mid(samples.map((s) => Number(s[i] ?? 0)))
  const hex = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0')
  return `#${hex(ch(0))}${hex(ch(1))}${hex(ch(2))}`
}

/**
 * 采样一帧的「纸色」：顶边与底边各取若干点。
 *
 * 用途：阅读器把这两色当成上下灰带的填充色 —— 菜单关着时屏幕看起来就是「整屏都是
 * 谱面」，而不是「谱面上压了两条灰条」（用户 2026-10-08 要求）。所以取的是**贴边**
 * 的位置（扫描件的页边留白）而不是整页平均：只有那里才是「这张纸的底色」。
 *
 * 返回 null = 取不到（画布不支持 getImageData / 尺寸为 0）——调用方保持原色。
 */
export function sampleEdgeColors(node: CanvasNode): { top: string; bottom: string } | null {
  try {
    const ctx = node.getContext('2d')
    if (!ctx?.getImageData) return null
    const w = node.width
    const h = node.height
    if (!w || !h) return null
    // 采样行离边 1% 页高（至少 2px）：避开扫描件最外圈那一条压边/裁切痕迹，
    // 但仍远在页边留白里
    const inset = Math.max(2, Math.round(h * 0.01))
    const xs = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => Math.min(w - 1, Math.floor(f * w)))
    const row = (y: number): ArrayLike<number>[] =>
      xs.map((x) => ctx.getImageData(x, Math.min(h - 1, Math.max(0, y)), 1, 1).data)
    return { top: medianHex(row(inset)), bottom: medianHex(row(h - 1 - inset)) }
  } catch {
    return null
  }
}

/**
 * 抽样看这一帧有没有墨：预绘制把整页 JPEG 画进备用块之后用它验一次，全白（0）
 * 就丢弃这一帧、交回常规路径。返回 -1 表示探测本身失败，不参与判定。
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
