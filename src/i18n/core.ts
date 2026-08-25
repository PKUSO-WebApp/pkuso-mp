import type { Dict, Path } from './types'
import { zhCN } from './messages/zh-CN'
import type { ZHCNMessages } from './messages/zh-CN'
import type { Locale } from './storage'

export type TFn = (key: Path<ZHCNMessages>, params?: Record<string, string | number>) => string

// 模块级「当前语言/字典」镜像：供 Provider 之外的渲染（ErrorBoundary、框架独立槽位的
// CustomTabBar、纯函数 lib 如 date-utils）通过 translateCurrent / subscribeLocale 取词，
// 避免依赖 React Context 与 @tarojs/taro（本模块刻意不引入 Taro，便于在测试/node 环境直接加载）。
let currentLocale: Locale = 'zh-CN'
let currentDict: Dict = zhCN as Dict
const localeListeners = new Set<() => void>()

export function getLocale(): Locale {
  return currentLocale
}

/** 不依赖 Provider 的翻译（读模块级当前字典），供 class 组件 / Provider 之外的场景使用 */
export function translateCurrent(key: string, params?: Record<string, string | number>): string {
  return translate(currentDict, key, params)
}

/** 订阅语言变化（模块级），供 Provider 之外的组件重渲染 */
export function subscribeLocale(cb: () => void): () => void {
  localeListeners.add(cb)
  return () => {
    localeListeners.delete(cb)
  }
}

/** 由 LanguageProvider 在语言/字典变化时调用，同步模块级镜像 */
export function setLocaleMirror(locale: Locale, dict: Dict): void {
  currentLocale = locale
  currentDict = dict
  localeListeners.forEach((cb) => cb())
}

function getByPath(dict: Dict, path: string): string | undefined {
  const parts = path.split('.')
  let cur: unknown = dict
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return typeof cur === 'string' ? cur : undefined
}

function interpolate(s: string, params?: Record<string, string | number>): string {
  if (!params) return s
  return s.replace(/\{(\w+)\}/g, (_m, k: string) =>
    params[k] !== undefined ? String(params[k]) : `{${k}}`
  )
}

/** 纯函数翻译（便于单测）；缺失 key 时回退到 key 本身 */
export function translate(dict: Dict, key: string, params?: Record<string, string | number>): string {
  return interpolate(getByPath(dict, key) ?? key, params)
}

export type { Dict, Path, ZHCNMessages, Locale }
