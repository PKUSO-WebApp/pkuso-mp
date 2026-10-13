import Taro from '@tarojs/taro'

/**
 * 显示大小：一个三档的用户偏好（**衡量的是绝对尺寸，不是「占屏比例」**）。
 *
 * ## 为什么需要它：这个 App 里有两套尺度在同屏打架
 *
 * - **rpx 层**（所有 Tailwind 类：字号 364 处、间距、圆角）：`750rpx = 屏宽` ⇒ 同一份代码在
 *   iPad（768pt）上每 rpx ≈ 1.02px，`text-sm` 28rpx 渲染成 **28.7px**（手机 14px）—— **约 2 倍**。
 *   这就是「平板太大」的来源。
 * - **内联 px 层**（底边栏 50px、阅读器工具条常量…）：**不随屏宽变** ⇒ 平板上还是手机的绝对
 *   尺寸 —— 这就是「平板太小」的来源。
 *
 * 两层的自然行为相反，所以「一个系数乘两层」是错的方向。这里的做法是**给两层定同一个基准**：
 * 都回到「375pt 手机上的绝对尺寸」（用户 2026-10-13 拍板：平板上的标准档 = 跟手机一样大），
 * 用户档位再在这个基准上乘一个系数。
 *
 * 落到实现上，两层各用各的手段（见 app.css 的 `.ui-scale` 与 `uiScaleFactor`）：
 * - rpx 层：CSS 变量 `--ui-dev`（媒体查询按屏宽给：手机上 1，iPad 上 ≈0.49）把放大抵消掉；
 * - 内联 px 层：它本来就是绝对尺寸，**只乘档位系数**。
 */

export type UiScale = 'compact' | 'normal' | 'large' | 'xlarge'

/** 存储键（沿用本仓 `pkuso-` 前缀的习惯，与 pkuso-theme 一致） */
export const UI_SCALE_KEY = 'pkuso-ui-scale'

/**
 * 四档。**默认 1.00x**（用户 2026-10-13 定：不做按设备自动切档）。
 * 顺序即 UI 里的顺序（由小到大），界面按系数显示 `0.85x / 1.00x / 1.25x / 1.50x`
 * （用户 2026-10-13 定：直接用倍率叫，不用「紧凑/标准/宽松」这类形容词）。
 */
export const UI_SCALE_OPTIONS: readonly UiScale[] = ['compact', 'normal', 'large', 'xlarge']

/**
 * 档位系数（**界面直接按它显示**：`0.85x` … `1.50x`）。
 *
 * ⚠️ 这组值是**乘在「手机绝对尺寸」上的**：1.00x 就是「和手机一样大」，也就是平板上的基准。
 * 1.50x 是给「就想大一点」的人（旧平板的观感约 2x，不打算复刻）。真机看着不对就改这里 ——
 * 全站只有这一份数字（CSS 侧的 `.ui-k-*` 是另一份，两处必须一致）。
 */
export const UI_SCALE_FACTOR: Record<UiScale, number> = {
  compact: 0.85,
  normal: 1,
  large: 1.25,
  xlarge: 1.5,
}

/** 基准屏宽：设计稿的绝对尺寸以 375pt 手机为准（该宽度下 1rpx = 0.5px） */
export const UI_BASE_WIDTH = 375

export const isUiScale = (v: unknown): v is UiScale => UI_SCALE_OPTIONS.includes(v as UiScale)

/**
 * 选项文案：**就是倍率本身**（`0.85x` / `1.00x` / `1.25x` / `1.50x`）。
 *
 * 不走 `translateCurrent` 是因为它不需要翻译 —— 用户 2026-10-13 定：直接用倍率叫，
 * 比「紧凑/标准/宽松」这种形容词准（同样的词在手机和平板上含义完全不同）。
 */
export const uiScaleLabel = (v: UiScale): string => `${uiScaleFactor(v).toFixed(2)}x`

export function uiScaleFactor(v: UiScale): number {
  return UI_SCALE_FACTOR[v] ?? 1
}

/** 页根挂的类：`--ui-k` 由它给（`--ui-dev` 由 app.css 的媒体查询给） */
export function uiScaleClass(v: UiScale): string {
  return `ui-scale ui-k-${v}`
}

/** 读偏好；没写过 / 存储不可用一律按「标准」（不是错误） */
export function readStoredUiScale(): UiScale {
  try {
    const raw = Taro.getStorageSync(UI_SCALE_KEY)
    return isUiScale(raw) ? raw : 'normal'
  } catch {
    return 'normal'
  }
}

export function writeUiScale(v: UiScale): void {
  try {
    Taro.setStorageSync(UI_SCALE_KEY, v)
  } catch {
    // 存不下只影响下次进来的默认值，不该影响这次切换
  }
}

/**
 * 底边栏容器高度（不含安全区），单位是**内联 px**（不被 Taro 转 rpx）。
 *
 * ⚠️ 这个常量在仓库里曾是**三份互指的副本**（底边栏自己 + 每个 tab 页根的预留 +
 * 社区的悬浮按钮偏移），AGENTS.md §7 专门记着「改一处必须同时改另两处」。
 * 现在改成：底边栏与页面预留**都从这里取**——档位一变，两边一起变，不会再出现
 * 「底边栏长高了、页面还按老高度预留 ⇒ 最后一行被永久遮住」。
 */
export const TAB_BAR_HEIGHT_PX = 50

/** 底边栏高度（含档位系数；保留两位小数，避免出现 42.499999 这种值） */
export function tabBarHeightPx(factor: number): number {
  return Math.round(TAB_BAR_HEIGHT_PX * factor * 100) / 100
}

/** 页面根预留底边栏用的内联 style 值（必须内联：类里的 px 会被 Taro 转成 rpx） */
export function tabBarReserveCss(factor: number): string {
  return `calc(${tabBarHeightPx(factor)}px + env(safe-area-inset-bottom))`
}
