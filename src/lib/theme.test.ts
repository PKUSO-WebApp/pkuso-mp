import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveTheme, isThemePreference, themeLabel, THEME_OPTIONS } from '@/lib/theme'

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorage: () => Promise.resolve({ data: null }),
    setStorage: () => Promise.resolve(),
  },
}))

describe('theme 纯函数', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('resolveTheme：显式亮/暗，无存储默认亮色', () => {
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
    expect(resolveTheme(null)).toBe('light')
    expect(resolveTheme(undefined)).toBe('light')
  })

  it('isThemePreference 只接受亮/暗', () => {
    expect(isThemePreference('light')).toBe(true)
    expect(isThemePreference('dark')).toBe(true)
    expect(isThemePreference('system')).toBe(false)
    expect(isThemePreference('blue')).toBe(false)
    expect(isThemePreference(null)).toBe(false)
    expect(isThemePreference(123)).toBe(false)
  })

  it('themeLabel 二态文案', () => {
    expect(themeLabel('light')).toBe('亮色')
    expect(themeLabel('dark')).toBe('暗色')
  })

  it('THEME_OPTIONS 顺序固定为 亮色/暗色', () => {
    expect([...THEME_OPTIONS]).toEqual(['light', 'dark'])
  })
})
