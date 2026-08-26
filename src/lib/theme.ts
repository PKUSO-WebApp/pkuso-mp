/**
 * 主题机制（Web Issue #203 语义的小程序适配版）：亮色 / 暗色 / 跟随系统 三态。
 *
 * 与 Web 版差异：
 * - 存储：Taro.getStorage/setStorage（异步）替代 localStorage；
 * - 系统外观：Taro.getSystemInfoSync().theme 替代 matchMedia，实时跟随用
 *   Taro.onThemeChange（theme-context 中挂载）；
 * - 生效方式：页面内容经 theme-context 的 useThemeClass 在页面根节点挂 .dark
 *   类（app.css 中 .dark 覆盖语义 token，Tailwind 工具类引用 var(--color-*)
 *   随祖先类切换）；导航栏色经 Taro.setNavigationBarColor 同步。
 * - 首帧防闪烁：存储偏好经 getStorageSync 在 ThemeProvider 的 useState 初始化器中
 *   同步读出（照抄 i18n/storage.ts 模式），冷启动首帧即按最终模式渲染，无白闪。
 */

import Taro from '@tarojs/taro'
import { translateCurrent } from '@/i18n/core'

export const THEME_STORAGE_KEY = 'pkuso-theme'

/** 用户三态选择：亮色 / 暗色 / 跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 实际生效的模式（跟随系统解析后的最终结果） */
export type ThemeMode = 'light' | 'dark'

/** 三态选项（供 Toggle 分段控件使用） */
export const THEME_OPTIONS: readonly ThemePreference[] = ['light', 'dark', 'system']

/** 选项文案（随语言本地化） */
export const themeLabel = (v: ThemePreference): string =>
  translateCurrent(
    v === 'dark'
      ? 'profile.appearance.dark'
      : v === 'light'
        ? 'profile.appearance.light'
        : 'profile.appearance.followSystemShort'
  )

export const isThemePreference = (v: unknown): v is ThemePreference =>
  v === 'light' || v === 'dark' || v === 'system'

/**
 * 核心解析规则：给定存储偏好 + 系统暗色偏好 → 最终亮/暗。
 * 无存储（null，即默认）按跟随系统处理。
 */
export function resolveTheme(
  preference: ThemePreference | null | undefined,
  systemDark: boolean
): ThemeMode {
  if (preference === 'light') return 'light'
  if (preference === 'dark') return 'dark'
  return systemDark ? 'dark' : 'light'
}

/** 系统是否为暗色外观；API 不可用/异常时按亮色处理 */
export function getSystemDark(): boolean {
  try {
    return Taro.getSystemInfoSync().theme === 'dark'
  } catch {
    return false
  }
}

/** 同步读取存储偏好；无存储或值非法时返回 null（调用方按默认 system 处理）。
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
