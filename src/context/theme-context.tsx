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
  getSystemDark,
  readStoredTheme,
  resolveTheme,
  writeThemePreference,
  type ThemePreference,
  type ThemeMode,
} from '@/lib/theme'

export type ThemeContextValue = {
  /** 用户三态选择（亮色 / 暗色 / 跟随系统） */
  preference: ThemePreference
  /** 实际生效的亮/暗模式（system 时由系统偏好解析） */
  mode: ThemeMode
  /** 切换偏好：即时生效 + 持久化（显式选择，含 system） */
  setPreference: (value: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

/** 导航栏配色（与 app.css 亮/暗语义 token 对应的页面/卡片底色） */
const NAV_BAR_COLORS: Record<ThemeMode, { frontColor: string; backgroundColor: string }> = {
  light: { frontColor: '#000000', backgroundColor: '#f4f4f5' },
  dark: { frontColor: '#ffffff', backgroundColor: '#09090b' },
}

/** 页面窗口（page 元素）与 tabBar 配色：页面根 View 只覆盖内容区，
    滚动阻尼/下拉露出的窗口底色与原生 tabBar 需随模式同步，
    否则暗色模式下背景仍是白色（app.config 的 backgroundColor 是静态的） */
const WINDOW_COLORS: Record<
  ThemeMode,
  {
    backgroundColor: string
    tabBar: { backgroundColor: string; color: string; selectedColor: string }
  }
> = {
  light: {
    backgroundColor: '#f4f4f5',
    tabBar: { backgroundColor: '#ffffff', color: '#71717a', selectedColor: '#18181b' },
  },
  dark: {
    backgroundColor: '#09090b',
    tabBar: { backgroundColor: '#09090b', color: '#a1a1aa', selectedColor: '#f4f4f5' },
  },
}

/**
 * 全局主题 Provider：全站共享一份主题状态与系统外观监听（Web Issue #203 语义）。
 * 默认（无存储 = 跟随系统）；系统外观变化实时跟随（Taro.onThemeChange）。
 * 生效方式：
 * - 页面内容：useThemeClass 在页面根节点挂 .dark 类（app.css 中 .dark 覆盖
 *   语义 token，Tailwind 工具类引用 var(--color-*) 随祖先类切换）；
 * - 导航栏：Taro.setNavigationBarColor 同步。
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system')
  const [systemDark, setSystemDark] = useState<boolean>(() => getSystemDark())
  const mode = resolveTheme(preference, systemDark)

  // 挂载后读取存储偏好覆盖默认值（存储为异步，只能在 effect 中读）
  useEffect(() => {
    let cancelled = false
    void readStoredTheme().then((stored) => {
      if (!cancelled && stored) setPreferenceState(stored)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 导航栏/窗口底色/tabBar 配色跟随实际模式
  useEffect(() => {
    const colors = NAV_BAR_COLORS[mode]
    const windowColors = WINDOW_COLORS[mode]
    // 非 tab 页调 setTabBarStyle 会 reject，统一 catch 静默（非页面环境如测试同样跳过）
    const noop = () => {}
    try {
      void Taro.setNavigationBarColor(colors).catch(noop)
      // page 元素背景（窗口底色）：页面根 View 盖不到滚动阻尼露出的区域
      void Taro.setBackgroundColor({ backgroundColor: windowColors.backgroundColor }).catch(noop)
      // 原生 tabBar 静态配置不会随主题切换，需运行时同步
      void Taro.setTabBarStyle({
        backgroundColor: windowColors.tabBar.backgroundColor,
        color: windowColors.tabBar.color,
        selectedColor: windowColors.tabBar.selectedColor,
        borderStyle: 'black',
      }).catch(noop)
    } catch {
      // 非页面环境（如测试）静默跳过
    }
  }, [mode])

  // system 模式下监听系统外观变化实时跟随；切到 light/dark 时清理监听
  useEffect(() => {
    if (preference !== 'system') return
    if (typeof Taro.onThemeChange !== 'function') return
    const handler = (res: { theme?: string }) => {
      setSystemDark(res.theme === 'dark')
    }
    Taro.onThemeChange(handler)
    // Taro 无 offThemeChange 对称 API 时监听常驻（Provider 全局唯一，可接受）
    return () => {
      if (typeof Taro.offThemeChange === 'function') Taro.offThemeChange(handler)
    }
  }, [preference])

  /** 切换偏好：即时更新状态 + 持久化（显式选择，含 system） */
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

/** 页面根节点暗色类名：mode 为 dark 时返回 'dark'，否则空串（供各页根 View className 拼接） */
export function useThemeClass(): string {
  const { mode } = useThemeContext()
  return mode === 'dark' ? 'dark' : ''
}
