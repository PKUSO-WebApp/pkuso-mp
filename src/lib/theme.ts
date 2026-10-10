/**
 * 主题机制：亮色 / 暗色 二态。
 */

import Taro from '@tarojs/taro'
import { translateCurrent } from '@/i18n/core'

export const THEME_STORAGE_KEY = 'pkuso-theme'

/** 用户二态选择：亮色 / 暗色 */
export type ThemePreference = 'light' | 'dark'

/** 实际生效的模式 */
export type ThemeMode = 'light' | 'dark'

/** 二态选项（供 Toggle 分段控件使用） */
export const THEME_OPTIONS: readonly ThemePreference[] = ['light', 'dark']

/** 选项文案（随语言本地化） */
export const themeLabel = (v: ThemePreference): string =>
  translateCurrent(v === 'dark' ? 'profile.appearance.dark' : 'profile.appearance.light')

export const isThemePreference = (v: unknown): v is ThemePreference => v === 'light' || v === 'dark'

/** 导航栏 / 窗口 / tabBar 配色单一真相源（theme-context 与 CustomTabBar 共用，P2-8）。
 *  取值与 app.css 语义 token 的亮/暗值一一对应，消除多处手写色板漂移 */
export type ThemePalette = {
  /** 页面窗口（page 元素）底色（滚动阻尼露出的区域） */
  windowBg: string
  /** 原生导航栏前景 / 底色 */
  navFront: string
  navBg: string
  /** tabBar 容器底色 / 描边 / 选中文字 / 未选中文字 */
  tabBg: string
  tabBorder: string
  tabActive: string
  tabInactive: string
  /** tabBar 未读红点（= --color-danger token 对应值） */
  tabDot: string
}

/** 各字段对应的 app.css 语义 token（改色时两边一起改；`theme.test.ts` 守着这层对应）：
 *  windowBg → --color-page-bg            navBg / tabBg → --color-surface
 *  tabBorder → --color-border            tabActive → --color-text
 *  tabInactive → --color-text-muted      tabDot → --color-danger
 *  navFront 是例外：原生导航栏前景固定取纯黑/纯白（不跟 --color-text 走）。
 *  另：windowBg 还必须等于 src/theme.json 的暗/亮 backgroundColor——两者不同的话，
 *  下拉回弹会露出色带。 */
export const THEME_PALETTE: Record<ThemeMode, ThemePalette> = {
  light: {
    windowBg: '#f4f4f5',
    navFront: '#000000',
    navBg: '#ffffff',
    tabBg: '#ffffff',
    tabBorder: '#e4e4e7',
    tabActive: '#18181b',
    tabInactive: '#71717a',
    tabDot: '#dc2626',
  },
  dark: {
    windowBg: '#09090b',
    navFront: '#ffffff',
    navBg: '#09090b',
    tabBg: '#09090b',
    tabBorder: '#27272a',
    tabActive: '#f4f4f5',
    tabInactive: '#a1a1aa',
    tabDot: '#f87171',
  },
}

/** 原生输入框 placeholder 的文字色。原生 Input 不吃 CSS 变量，只能写死；
 *  取值等于 app.css 的 --color-text-muted（有测试守着）。 */
export const PLACEHOLDER_COLOR: Record<ThemeMode, string> = {
  light: '#71717a',
  dark: '#a1a1aa',
}

/**
 * 核心解析规则：给定存储偏好 → 最终亮/暗。
 * 无存储（null，即默认）按亮色处理。
 */
export function resolveTheme(preference: ThemePreference | null | undefined): ThemeMode {
  if (preference === 'dark') return 'dark'
  return 'light'
}

/** 同步读取存储偏好；无存储或值非法时返回 null（调用方按默认亮色处理）。
    冷启动首帧在 Provider useState 初始化器中同步调用，暗色偏好首帧即生效，无白闪 */
export function readStoredThemeSync(): ThemePreference | null {
  try {
    const raw = Taro.getStorageSync(THEME_STORAGE_KEY)
    return typeof raw === 'string' && isThemePreference(raw) ? raw : null
  } catch {
    return null
  }
}

/** 写入存储偏好；存储不可用时静默跳过，仅当前会话生效 */
export async function writeThemePreference(value: ThemePreference): Promise<void> {
  try {
    await Taro.setStorage({ key: THEME_STORAGE_KEY, data: value })
  } catch {
    // 存储不可用：不持久化，本次选择仍即时生效
  }
}
