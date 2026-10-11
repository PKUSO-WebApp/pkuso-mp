/**
 * 阅读器的手势判定：tap / swipe 分类与阈值（纯函数，无 Taro 依赖）。
 *
 * **判定只在抬手时做**，移动阶段不做轴锁。理由见 index.tsx 的触摸注释：
 * 轴锁一旦在起手抖动时判错，竖直滚谱会当场卡死且无法挽回（手指还在屏上）；
 * 而未放大时内容框不宽于视口，横滑造成的平移本来就是空操作，所以
 * 「移动阶段照常平移」没有任何可观察代价。
 *
 * 阈值分两类，别混：
 * - **跟屏幕走的**（翻页要滑多远）：按视口宽的比例算，见 `swipeMinPx`；
 * - **跟手指物理走的**（抖动上限、长按上限、系统边缘手势区）：固定 px / ms，
 *   它们描述的是指头与系统，不随屏幕变大变小。这几条真机手感不对时改常量，别改成比例。
 */

/** 超过它就不算点击（与平台 longpress 的 350ms 对齐） */
export const TAP_MAX_MS = 350
/** 手势内最大位移超过它就不算点击——手指抖动是物理量，不随屏幕缩放 */
export const TAP_MAX_MOVE_PX = 12

/** 翻页的最小水平位移＝视口宽的这个比例（390pt 屏 ≈ 47px） */
export const SWIPE_MIN_RATIO = 0.12
/** 比例值的上下限：小屏别太灵敏、大屏别要滑太远 */
export const SWIPE_MIN_FLOOR_PX = 32
export const SWIPE_MIN_CEIL_PX = 72
/** 水平位移必须大于竖直位移的这个倍数，才算「水平为主」 */
export const SWIPE_RATIO = 1.25
/** 距视口左沿太近的起手不认右滑：iOS 系统边缘返回手势会抢（disableSwipeBack 自 7.0.5 失效）。
 *  它是系统定义的物理手势区（≈20pt），不按屏幕比例缩放。 */
export const EDGE_GUARD_PX = 24

/** -1 = 上一页（右滑）、1 = 下一页（左滑）、0 = 不算滑动 */
export type SwipeDir = -1 | 0 | 1

/** 手势记录里判定用得上的那几个字段（index.tsx 的 Drag 结构上满足它） */
export type GestureTrack = {
  /** 起手触点 client 坐标 */
  tx: number
  ty: number
  /** 起手时刻（Date.now()） */
  startAt: number
  /** 手势期间 |dx| / |dy| 的最大值——判 tap 用它而不是末点（横滑出去再滑回来会骗人） */
  maxMove: number
}

/** 这次翻页要滑够多少像素：按实测视口宽算，带上下限；还没量到视口时给下限 */
export function swipeMinPx(stageW: number): number {
  if (!(stageW > 0)) return SWIPE_MIN_FLOOR_PX
  return Math.min(SWIPE_MIN_CEIL_PX, Math.max(SWIPE_MIN_FLOOR_PX, stageW * SWIPE_MIN_RATIO))
}

/**
 * 是不是一次点击。**不设「没动就算」的捷径**：长按不动（>350ms）不算点击，
 * 免得用户按住谱面思考时把菜单开开关关。
 */
export function isTap(g: GestureTrack, now: number): boolean {
  return now - g.startAt <= TAP_MAX_MS && g.maxMove <= TAP_MAX_MOVE_PX
}

/**
 * 这一划算不算翻页、往哪翻。**不设时长上限**（只有 tap 有）：未放大时横向本来就
 * 无处可平移，「缓慢横滑 60px」只可能是想翻页；给上限反而会留下「拖了很久松手
 * 什么都没发生」的悬空感。`minPx` 由调用方用 `swipeMinPx(stageW)` 算好传进来。
 */
export function swipeDir(g: GestureTrack, endX: number, endY: number, minPx: number): SwipeDir {
  const dx = endX - g.tx
  const dy = endY - g.ty
  if (Math.abs(dx) < minPx) return 0
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return 0
  return dx < 0 ? 1 : -1
}

/** 起手贴左沿的右滑交给系统返回手势，我们不翻页（只作用于右滑，不影响点击分区） */
export function blockedByEdgeGuard(startRelX: number, dir: SwipeDir): boolean {
  return dir === -1 && startRelX < EDGE_GUARD_PX
}

/**
 * 100% 处的「吸附带」半宽：捏合时 raw 落在这条带子里一律吸到 100%。
 * 真机手感旋钮——带子越宽越"黏"（要更用力才能离开 100%）。
 */
export const ZOOM_SNAP_BAND = 0.1

/**
 * 捏合缩放的吸附（detent）：把 100% 附近吸住，好让用户稳稳落在 1.0
 * （灰带与左右滑翻页都以「未放大」为条件，差 2% 就会整片行为不同）。
 *
 * 出带子后**平移** band 而不是直接放行 raw：这样输出是连续的（在带的边界处正好等于 1.0），
 * 「用力一点」表现为推过一段距离画面才开始变，而不是到某个点突然跳一下。
 * 对称 ⇒ 缩小方向同理（从 2.0 往回收会先黏在 100%，要再往里推才继续缩）。
 *
 * 注意：捏合的上下限因此各内缩了一个 band（0.5→0.6、4→3.9）；按钮不走这里，
 * 仍能到 0.5 / 4.0。
 */
export function snapZoom(raw: number, detent = 1, band = ZOOM_SNAP_BAND): number {
  if (band <= 0) return raw
  if (raw > detent + band) return raw - band
  if (raw < detent - band) return raw + band
  return detent
}
