import type { Job, Layer } from './types'

/**
 * 预绘制（把「下一页」提前画进空闲的那块画布）的判据：目标页、备用块上那一帧还能不能用、
 * 该不该开工。状态机本身在 index.tsx（要动 ref 与队列），这里只放能单测的部分。
 *
 * 目标：翻页的关键路径上不出现任何加载——用户翻到某页时，只要备用块上正好是它，
 * 就只换帧 + 播滑出动画（≈0ms 等待）。取图与绘制全部挪到「停在这一页、队列空闲」时做。
 */

export type PredrawKey = { page: number; zoom: number; containerW: number; layer: Layer }
export type PredrawFrame = PredrawKey & {
  /** 落帧时算好的内容框尺寸与高宽比：命中时直接落地，免去再取一次图片尺寸 */
  cssW: number
  cssH: number
  aspect: number
  /** 落帧时刻（Date.now()），只用于诊断 ageMs，不设 TTL */
  at: number
}

/**
 * 备用块上那一帧还能不能用：**四个键全等**才算命中。
 *
 * `layer` 必须有：预绘制画在「发起时的反面块」上，之后的任何交互渲染都可能写进那块
 * （渲染永远写当前显示块的反面）。少比一项就会把上一页的内容当成目标页换上去——
 * 那比白页更坏。
 */
export function predrawMatches(f: PredrawFrame | null, want: PredrawKey): boolean {
  if (!f) return false
  return (
    f.page === want.page &&
    f.zoom === want.zoom &&
    f.containerW === want.containerW &&
    f.layer === want.layer
  )
}

/**
 * 预绘制哪一页：下一页；已经是末页就备上一页（末页往回翻永远是冷的）；单页册子不备。
 * 不做双向：只有两块画布，备用块只能装一页，装上一页就得挤掉下一页。
 */
export function pickPredrawTarget(page: number, total: number): number | null {
  if (total <= 1) return null
  if (page < total) return page + 1
  return page > 1 ? page - 1 : null
}

/**
 * 「采纳（adopt）失败」时该不该把这一页**交回常规渲染路径**；null = 不用管。
 *
 * 采纳的含义是「用户已经翻到这一页了，正在等它」：那条请求完全寄托在预绘制的成功路径上，
 * 所以只要它没能把帧换上（取图失败 / 白帧 / 被失效打断），就必须补一次常规渲染，
 * 否则页码显示 N+1、画面停在 N、队列还是空的——用户下一次翻页直接跳到 N+2，**漏读一页**。
 *
 * ⚠️ 判据里**没有** cancelled / 失效世代：被 `invalidatePredraw`（回前台、转屏、换册）
 * 打断同样是「没能把帧换上」，同样要交回去。带上它就会让兜底自己否决自己。
 */
export function predrawFallback(opts: {
  adopt: boolean
  /** 预绘制这一件准备的是哪一页/哪个缩放 */
  target: number
  zoom: number
  /** 当前真实状态：只有它们仍然指向这一页时才值得补渲染 */
  currentPage: number
  currentZoom: number
}): Job | null {
  if (!opts.adopt) return null
  if (opts.currentPage !== opts.target || opts.currentZoom !== opts.zoom) return null
  return { page: opts.target, zoom: opts.zoom }
}

/** 换帧后先让滑出动画停稳（TURN_MS + 余量）再动备用块 */
export const PREDRAW_IDLE_MS = 300
/** 等预热泵把目标页抓进图片缓存的宽限；超过就不等了（弱网下泵可能几十秒才轮到，无限等等于永不生效） */
export const PREDRAW_WARM_GRACE_MS = 1500
/** 「等预热」期间重新检查的间隔（要明显小于宽限，否则等一次就到头了） */
export const PREDRAW_WAIT_MS = 300

export type PredrawGo = 'skip' | 'wait' | 'start'

/**
 * 该不该现在开工。`wait` = 稍后重排（等泵把目标页抓进缓存，命中缓存约 50ms，
 * 抢在泵前面发就是对同一 URL 的重复请求）。
 *
 * `zoom > 1` 直接跳过：位图开销随 zoom² 涨，且放大后横滑不翻页、翻页只走按钮，收益低。
 */
export function predrawGo(s: {
  imageMode: boolean
  zoom: number
  animating: boolean
  queueBusy: boolean
  target: number | null
  warm: boolean
  waitedMs: number
}): PredrawGo {
  if (!s.imageMode || s.target === null || s.zoom > 1) return 'skip'
  if (s.animating || s.queueBusy) return 'skip'
  if (!s.warm && s.waitedMs <= PREDRAW_WARM_GRACE_MS) return 'wait'
  return 'start'
}
