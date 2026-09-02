import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { THEME_PALETTE } from '@/lib/theme'
import { getThemeMode, useThemeMode } from '@/lib/themeStore'
import { zhCN } from './messages/zh-CN'
import { en } from './messages/en'
import type { ZHCNMessages } from './messages/zh-CN'
import type { Path } from './types'
import { resolveInitialLanguage, setStoredLanguage, type Locale } from './storage'
import {
  translate,
  translateCurrent,
  getLocale,
  setLocaleMirror,
  type Dict,
  type TFn,
} from './core'

export * from './core'

type LangCtx = { locale: Locale; t: TFn; setLocale: (l: Locale) => void }

const LanguageContext = createContext<LangCtx | null>(null)

// zh-CN 与 en 均静态打包进主包：en 作为第二语言使用频率高，动态 import 会在冷启动
// 造成英文用户短暂的中文闪烁；静态引入后首屏即按 storage 中的语言渲染，无需等待 chunk。
export const loaders: Record<Locale, () => Promise<{ default: Dict }>> = {
  'zh-CN': async () => ({ default: zhCN as Dict }),
  en: async () => ({ default: en as Dict }),
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const initialLocale = resolveInitialLanguage()
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  const [dict, setDict] = useState<Dict>(initialLocale === 'en' ? (en as Dict) : (zhCN as Dict))

  useEffect(() => {
    let active = true
    loaders[locale]()
      .then((m) => {
        if (active) setDict(m.default)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [locale])

  // 同步模块级镜像，使 Provider 之外的 translateCurrent / subscribeLocale 也能随语言更新
  useEffect(() => {
    setLocaleMirror(locale, dict)
  }, [locale, dict])

  const t = useCallback<TFn>((key, params) => translate(dict, key, params), [dict])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    setStoredLanguage(l)
  }, [])

  return (
    <LanguageContext.Provider value={{ locale, t, setLocale }}>{children}</LanguageContext.Provider>
  )
}

export function useT(): LangCtx {
  const ctx = useContext(LanguageContext)
  // Provider 之外的渲染（ErrorBoundary、框架独立槽位的 CustomTabBar 等）回退到模块级字典，
  // 避免抛错；此时 setLocale 为 no-op（这些位置不支持就地切语言）。
  if (!ctx) {
    return {
      locale: getLocale(),
      t: (key, params) => translateCurrent(key, params),
      setLocale: () => {},
    }
  }
  return ctx
}

export function useLanguage(): LangCtx {
  return useT()
}

/**
 * 动态设置导航栏（微信顶栏）标题，随语言切换即时更新。
 * 各页 .config.ts 的 navigationBarTitleText 为静态中文，无法随语言变化，
 * 故移除静态值、改为在页面内调用本 hook 经 t() 设置。
 */
export function useNavTitle(key: Path<ZHCNMessages>, params?: Record<string, string | number>) {
  const { t, locale } = useT()
  const mode = useThemeMode()
  useDidShow(() => {
    try {
      Taro.setNavigationBarTitle({ title: t(key, params) })
      // 切回 tab 时微信会回退到 app.json 默认（白底），按当前主题重设顶栏配色
      const p = THEME_PALETTE[getThemeMode()]
      void Taro.setNavigationBarColor({ frontColor: p.navFront, backgroundColor: p.navBg }).catch(
        () => {}
      )
    } catch {
      /* 部分环境无 Taro 运行时，忽略 */
    }
  })
  useEffect(() => {
    try {
      Taro.setNavigationBarTitle({ title: t(key, params) })
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale])
  // 主题切换时即时同步当前页顶栏配色（切 tab 由 useDidShow 负责重设）
  useEffect(() => {
    const p = THEME_PALETTE[mode]
    try {
      void Taro.setNavigationBarColor({ frontColor: p.navFront, backgroundColor: p.navBg }).catch(
        () => {}
      )
    } catch {
      /* ignore */
    }
  }, [mode])
}
