import type { Job, Layer } from './types'

/**
 * 「邻居帧」记账 + 预绘制的判据（纯函数，全部可单测；编排在 index.tsx）。
 *
 * 模型：**每块画布记一笔「现在放着哪一页」**（`layerMetaRef`）。这么记而不是只留一个
 * 「预绘制槽」，是因为换帧之后**退役的那块画布上正好还是刚离开的那一页**——免费，
 * 不需要任何额外取图，它就是「往回翻」的现成帧；另一块上是预绘制好的「下一页」。
 * 两块各记各的，于是**两个方向都能直接换帧**（回翻不再是"看缓存心情"）。
 *
 * 三条不变量（index.tsx 里执行）：
 * 1. 任何渲染**决定要写某块**位图的瞬间就把它的记账清掉（`doRender` 开头）——留着就是上错页；
 * 2. 只有**画成功**（含白帧校验通过）才写回记账；
 * 3. 缩放/视口宽/换册变化时全部清掉（尺寸不对的帧不能用）。
 */

export type PredrawFrame = {
  page: number
  zoom: number
  containerW: number
  layer: Layer
  /** 落帧时算好的内容框尺寸与高宽比：命中时直接落地，免去再取一次图片尺寸 */
  cssW: number
  cssH: number
  aspect: number
  /** 落帧时刻（Date.now()），只用于诊断 ageMs，不设 TTL */
  at: number
}

export type LayerMetas = Record<Layer, PredrawFrame | null>

export const ALL_LAYERS: readonly Layer[] = ['a', 'b', 'c']

/** 邻居帧 = 不是显示中的那块、且缩放/视口宽与当前一致的那些 */
export function neighborFrames(
  metas: LayerMetas,
  active: Layer,
  want: { zoom: number; containerW: number }
): PredrawFrame[] {
  return (Object.values(metas) as Array<PredrawFrame | null>).filter(
    (f): f is PredrawFrame =>
      !!f && f.layer !== active && f.zoom === want.zoom && f.containerW === want.containerW
  )
}

/** 邻居里「正好是这一页」的那一帧 */
export function frameForPage(frames: readonly PredrawFrame[], page: number): PredrawFrame | null {
  return frames.find((f) => f.page === page) ?? null
}

/**
 * 当前页还缺哪个邻居——预绘制的目标就是它；两个都备好了就 null（什么都不用做）。
 * 先补「下一页」（往下翻是主方向），再补「上一页」。
 */
export function missingNeighbor(
  page: number,
  total: number,
  frames: readonly PredrawFrame[]
): number | null {
  const has = (p: number) => frames.some((f) => f.page === p)
  if (page + 1 <= total && !has(page + 1)) return page + 1
  if (page - 1 >= 1 && !has(page - 1)) return page - 1
  return null
}

/** 「这块画布该被写掉」的程度：越远越该弃；同样远时弃「上一页」、保「下一页」；没记账的最该弃 */
function discardable(f: PredrawFrame | null, currentPage: number): number {
  if (!f) return Number.POSITIVE_INFINITY
  return Math.abs(f.page - currentPage) * 2 + (f.page < currentPage ? 1 : 0)
}

/**
 * 该往哪块画布写：不是显示中的那块，且是「最该被写掉」的那块
 * （见 `discardable`：远的先弃、同远时弃上一页保下一页）。
 */
export function spareLayer(
  all: readonly Layer[],
  active: Layer,
  metas: LayerMetas,
  currentPage: number
): Layer {
  let best: Layer | null = null
  for (const l of all) {
    if (l === active) continue
    if (
      best === null ||
      discardable(metas[l], currentPage) > discardable(metas[best], currentPage)
    ) {
      best = l
    }
  }
  return best ?? active
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
/**
 * 做邻居帧/预绘制的最大缩放：位图面积随 zoom² 涨（zoom 4 时单块 ≈ 48MB，三块画布一起
 * 放大有内存风险）。2 以内覆盖了绝大多数放大读谱（±按钮到 2.0、捏合吸附也在低档），
 * 更大的缩放退回「只靠缓存」的老路径。
 */
export const NEIGHBOR_MAX_ZOOM = 2

export type PredrawGo = 'skip' | 'wait' | 'start'

/**
 * 该不该现在开工。`wait` = 稍后重排（等泵把目标页抓进缓存，命中缓存约 50ms，
 * 抢在泵前面发就是对同一 URL 的重复请求）。
 */
export function predrawGo(s: {
  zoom: number
  /** 正在捏合：缩放每帧都在变，等停手后那次重渲会再排一次 */
  pinching: boolean
  animating: boolean
  queueBusy: boolean
  target: number | null
  warm: boolean
  waitedMs: number
}): PredrawGo {
  if (s.target === null) return 'skip'
  if (s.zoom > NEIGHBOR_MAX_ZOOM) return 'skip'
  if (s.pinching || s.animating || s.queueBusy) return 'skip'
  if (!s.warm && s.waitedMs <= PREDRAW_WARM_GRACE_MS) return 'wait'
  return 'start'
}
