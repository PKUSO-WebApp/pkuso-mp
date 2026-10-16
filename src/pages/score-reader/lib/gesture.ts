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

/**
 * 「第二指是捏合还是手掌」的窗口 —— 只在**批注模式下正在画**的时候才问这个问题。
 *
 * 背景：批注模式从前一律「正在画就不打断」（2026-10-15 为真机「写着写着、手一碰，线整条
 * 消失」加的守卫），代价是**批注模式下根本捏合不了**：第一根手指落下就起笔，第二指永远撞
 * 守卫（把取 rect 改成同步之后，连原来那条 ~100ms 的空窗也没了）。
 *
 * 修法不是取消守卫，而是**给它加一个窗口**：第二指在起笔后 ≤150ms 落下、**且这一笔还没动**
 * ⇒ 两根手指是一起落下的，判捏合（撤掉这一笔、进双指）；晚于窗口、或这一笔已经在动
 * ⇒ 是写着写着落下来的手掌，照旧不打断。
 *
 * 150 取自「守卫生效前那条路」的实际窗口（那时落笔要跨线程取 rect，~100ms 里第二指挤得进来）。
 */
export const PINCH_GRACE_MS = 150
/** 窗口内还允许的笔迹位移（屏幕 px；手指的物理量，不随屏幕缩放）—— 超过它就算「已经在画了」 */
export const PINCH_GRACE_MAX_MOVE_PX = 8
/** 窗口内还允许的点数（起点 + 攒下的触点）—— 与位移互为保险，防「瞬间划出去又划回来」 */
export const PINCH_GRACE_MAX_PTS = 2

/**
 * 第二指落下时，要不要把它当捏合（撤掉这一笔、进双指）？
 *
 * ⚠️ 调用方只在 `drawing` 为真时问它（没在画时双指本来就是捏合）。
 * 三个条件缺一不可 —— 其中「没动」是**手掌与捏合的分界**：捏合是两指几乎同时落下
 *（第一指还没来得及画出东西），手掌是「写着写着」才落下来的，那时笔迹已经在动了。
 */
export function pinchGraceActive(input: {
  /** 落笔到现在多久（ms） */
  sinceStartMs: number
  /** 这一笔现有的点数 */
  pts: number
  /** 这一笔从起点到最后一个点的**屏幕**位移（px） */
  movedPx: number
}): boolean {
  return (
    input.sinceStartMs <= PINCH_GRACE_MS &&
    input.pts <= PINCH_GRACE_MAX_PTS &&
    input.movedPx < PINCH_GRACE_MAX_MOVE_PX
  )
}
