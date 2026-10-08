/**
 * 阅读器的布局判据：点击分区、灰带命中、层级。
 *
 * 抽成一处是为了让**三份东西共用同一组数**：教程蒙层里画的示意线、触摸的命中判定、
 * 灰带与工具条的实际高度。各写一份魔法数就会漂移（「线画在 25%、判定在 28%」这类）。
 *
 * ⚠️ **尺寸一律实测，不写死**：视口用 `measureStage` 量到的 `containerW/H`；
 * 工具条高度在 `measureStage` 里连 `#reader-topbar` / `#reader-bottombar` 一起量
 * （见 index.tsx），量到什么用什么。理由：微信的系统字体大小会改工具条高度，
 * 写死常量在大字体机型上会让灰带与工具条错位、点击分区也跟着偏。
 * 需要内联 px 的地方（className 里的 px 会被 pxtransform 转 rpx）用**量到的数**。
 */

/** 点击分区边界（占视口宽的比例）：左 25% 上一页、中 50% 开关菜单、右 25% 下一页 */
export const ZONE_SPLITS = [0.25, 0.75] as const

export type TapZone = 'prev' | 'menu' | 'next'

/**
 * 落点在哪个分区。视口还没量到（`stageW <= 0`）时**一律当中间区**：
 * 菜单默认隐藏，必须保证任何时刻点中间都能把它叫出来。
 */
export function zoneFor(relX: number, stageW: number): TapZone {
  if (!(stageW > 0)) return 'menu'
  if (relX < stageW * ZONE_SPLITS[0]) return 'prev'
  if (relX < stageW * ZONE_SPLITS[1]) return 'menu'
  return 'next'
}

export type Band = 'top' | 'bottom'

/**
 * 起手落点是否落在灰带里（菜单隐藏时上下那两条「隐藏的菜单」占位）。
 * 高度传**实测的工具条高度**；还没量到（0）时不算灰带，走普通分区。
 */
export function bandAt(
  relY: number,
  stageH: number,
  topBarH: number,
  bottomBarH: number
): Band | null {
  if (!(stageH > 0)) return null
  if (topBarH > 0 && relY <= topBarH) return 'top'
  if (bottomBarH > 0 && relY >= stageH - bottomBarH) return 'bottom'
  return null
}

/**
 * 层级。画布自己的 1/2/3 见 index.tsx 的 layerStyle——`#reader-stage` 是
 * `position:relative; z-index:auto`，**不构成堆叠上下文**，所以画布的 z-index 会
 * 逃逸到页面根：工具条作为兄弟节点若不给显式 z-index，会被画在画布下面。
 */
export const Z_BAND = 4
/** 页码徽标（贴在谱面右下角）：要在画布（滑出中的那块是 3）**和灰带（4）**之上——
    谱面下沿落到灰带里时它也得看得见；但低于状态行（9）与工具条（12） */
export const Z_PAGE_BADGE = 5
export const Z_STATUS = 9
export const Z_TOOLBAR = 12
export const Z_TUTORIAL = 60

export const SAFE_BOTTOM = 'env(safe-area-inset-bottom)'

/**
 * 批注工具条的底边 = 底栏的实测高度（它已经含安全区，别再叠加一次）。
 * 传 0（还没量到）时给安全区兜底，至少不压在 home indicator 上。
 */
export const penBarBottom = (bottomBarH: number): string =>
  bottomBarH > 0 ? `${bottomBarH}px` : SAFE_BOTTOM
