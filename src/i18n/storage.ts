import Taro from '@tarojs/taro'

export type Locale = 'zh-CN' | 'en'

/** 已实现（可切换）的语言列表：新增语言只需在此登记 + 在 loaders 注册即可自动纳入各处循环/切换 */
export const LOCALES: Locale[] = ['zh-CN', 'en']

const KEY = 'appLanguage'

/** 跟随系统语言：微信系统语言以 en 开头视为英文，其余回退中文 */
export function getSystemLanguage(): Locale {
  try {
    const lang = (Taro.getAppBaseInfo?.().language ?? '') as string
    return lang.toLowerCase().startsWith('en') ? 'en' : 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}

export function getStoredLanguage(): Locale | null {
  try {
    const v = Taro.getStorageSync(KEY)
    return v === 'en' || v === 'zh-CN' ? v : null
  } catch {
    return null
  }
}

export function setStoredLanguage(l: Locale): void {
  try {
    Taro.setStorageSync(KEY, l)
  } catch {
    /* ignore quota / unsupported */
  }
}

/** 默认跟随系统：本地无手动覆盖时取系统语言 */
export function resolveInitialLanguage(): Locale {
  return getStoredLanguage() ?? getSystemLanguage()
}
