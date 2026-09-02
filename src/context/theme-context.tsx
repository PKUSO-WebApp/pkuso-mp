import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import Taro from '@tarojs/taro'
import {
  readStoredThemeSync,
  resolveTheme,
  writeThemePreference,
  THEME_PALETTE,
  type ThemePreference,
  type ThemeMode,
} from '@/lib/theme'
import { setThemeMode } from '@/lib/themeStore'

export type ThemeContextValue = {
  /** 用户二态选择（亮色 / 暗色） */
  preference: ThemePreference
  /** 实际生效的亮/暗模式 */
  mode: ThemeMode
  /** 切换偏好：即时生效 + 持久化 */
  setPreference: (value: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

/**
 * 全局主题 Provider：全站共享一份主题状态。
 * 默认（无存储 = 亮色）。
 * 生效方式：
 * - 页面内容：useThemeClass 在页面根节点挂 .dark 类；
 * - 导航栏：Taro.setNavigationBarColor 同步。
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    () => readStoredThemeSync() ?? 'light'
  )
  const mode = resolveTheme(preference)

  // 导航栏/窗口底色跟随实际模式
  useEffect(() => {
    const p = THEME_PALETTE[mode]
    const noop = () => {}
    try {
      void Taro.setNavigationBarColor({ frontColor: p.navFront, backgroundColor: p.navBg }).catch(
        noop
      )
      void Taro.setBackgroundColor({ backgroundColor: p.windowBg }).catch(noop)
    } catch {
      // 非页面环境（如测试）静默跳过
    }
  }, [mode])

  // 推送当前模式到模块级 themeStore，供 custom tabBar 订阅
  useEffect(() => {
    setThemeMode(mode)
  }, [mode])

  /** 切换偏好：即时更新状态 + 持久化 */
  const setPreference = useCallback((value: ThemePreference) => {
    setPreferenceState(value)
    void writeThemePreference(value)
  }, [])

  const value = useMemo(
    () => ({ preference, mode, setPreference }),
    [preference, mode, setPreference]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useThemeContext 必须在 ThemeProvider 内部使用')
  }
  return ctx
}

/** 页面根节点暗色类名：mode 为 dark 时返回 'dark'，否则空串 */
export function useThemeClass(): string {
  const { mode } = useThemeContext()
  return mode === 'dark' ? 'dark' : ''
}
