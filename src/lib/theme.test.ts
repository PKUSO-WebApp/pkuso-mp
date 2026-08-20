import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveTheme, isThemePreference, themeLabel, THEME_OPTIONS } from '@/lib/theme'

// theme.ts 顶部导入 @tarojs/taro；mock 掉，resolveTheme 等纯函数不依赖其实例
// （vitest 自动提升 vi.mock，import 保持文件顶部满足 import/first）
vi.mock('@tarojs/taro', () => ({
  default: {
    getSystemInfoSync: () => ({ theme: 'light' }),
    getStorage: () => Promise.resolve({ data: null }),
    setStorage: () => Promise.resolve(),
  },
}))

describe('theme 纯函数', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('resolveTheme：显式亮/暗优先，system/无存储跟随系统', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme(null, true)).toBe('dark')
    expect(resolveTheme(undefined, false)).toBe('light')
  })

  it('isThemePreference 只接受三态合法值', () => {
    expect(isThemePreference('light')).toBe(true)
    expect(isThemePreference('dark')).toBe(true)
    expect(isThemePreference('system')).toBe(true)
    expect(isThemePreference('blue')).toBe(false)
    expect(isThemePreference(null)).toBe(false)
    expect(isThemePreference(123)).toBe(false)
  })

  it('themeLabel 三态文案', () => {
    expect(themeLabel('light')).toBe('亮色')
    expect(themeLabel('dark')).toBe('暗色')
    expect(themeLabel('system')).toBe('跟随系统')
  })

  it('THEME_OPTIONS 顺序固定为 亮色/暗色/跟随系统', () => {
    expect([...THEME_OPTIONS]).toEqual(['light', 'dark', 'system'])
  })
})
