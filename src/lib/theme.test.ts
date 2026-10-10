import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PLACEHOLDER_COLOR,
  resolveTheme,
  isThemePreference,
  themeLabel,
  THEME_OPTIONS,
  THEME_PALETTE,
} from '@/lib/theme'

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorage: () => Promise.resolve({ data: null }),
    setStorage: () => Promise.resolve(),
  },
}))

/**
 * 下面两组「token 一致性」测试守的是一条容易烂的约定：暗/亮色在仓库里有**三处**表达——
 *   1. `src/app.css` 的语义 token（页面通过 CSS 变量用）
 *   2. `src/lib/theme.ts` 的 THEME_PALETTE（原生导航栏 / tabBar 运行时用，吃不到 CSS 变量）
 *   3. `src/theme.json` 的原生窗口配色（微信在冷启动时读，早于 JS）
 * 三者必须对得上：1 与 2 不一致 → 页面是新色、原生栏是旧色；1 与 3 不一致 →
 * 下拉回弹时露出一条色带（本仓库踩过：暗色 page-bg 曾是 #1d1d1f，而 theme.json 是 #09090b）。
 */

// 用 process.cwd()（= 跑 vitest 时的工作目录，仓库根）而非 import.meta.url：
// 本仓库 tsconfig 是 module: commonjs，tsc 不允许 import.meta。
const readAppCss = () => fs.readFileSync(path.resolve(process.cwd(), 'src/app.css'), 'utf8')
const readThemeJson = () =>
  JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'src/theme.json'), 'utf8')) as Record<
    'light' | 'dark',
    { backgroundColor: string; navigationBarBackgroundColor: string }
  >

/** 解析一个 token 块。选择器必须处于行首、且后面直接跟 `{`——
 *  否则会匹配到文件头注释里出现的同名说明文字（我写这段验证时正是这么栽的）。 */
function parseTokens(css: string, selectorRe: RegExp, label: string): Map<string, string> {
  const m = selectorRe.exec(css)
  if (!m) throw new Error(`找不到选择器：${label}`)
  const start = css.indexOf('{', m.index)
  const end = css.indexOf('}', start)
  const out = new Map<string, string>()
  for (const t of css.slice(start + 1, end).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(t[1], t[2].trim().replace(/\s+/g, ' ').toLowerCase())
  }
  return out
}

// 亮色 token 在 Tailwind 4 的 @theme 块里（web 那边用的是 :root，两仓库写法不同）
const light = parseTokens(readAppCss(), /(?:^|\n)@theme\s*\{/, '@theme')
const dark = parseTokens(readAppCss(), /(?:^|\n)\.dark\s*\{/, '.dark')

/** THEME_PALETTE 字段 → app.css token（navFront 是例外，不走 token） */
const MAPPING = {
  windowBg: 'color-page-bg',
  navBg: 'color-surface',
  tabBg: 'color-surface',
  tabBorder: 'color-border',
  tabActive: 'color-text',
  tabInactive: 'color-text-muted',
  tabDot: 'color-danger',
  primary: 'color-primary',
} as const

describe('token 解析器自证', () => {
  it('解析到的是正确的块，而不是匹配到了注释里的同名文字', () => {
    // 若正则锚点写错（比如匹配到文件头注释），这两个值会露馅
    expect(light.get('color-page-bg')).toBe('#f4f4f5')
    expect(dark.get('color-page-bg')).toBe('#09090b')
    expect(light.size).toBeGreaterThan(15)
    expect(dark.size).toBeGreaterThan(15)
  })
})

describe('THEME_PALETTE 与 app.css token 一一对应', () => {
  for (const mode of ['light', 'dark'] as const) {
    const tokens = mode === 'light' ? light : dark
    it(`${mode}：8 个字段与对应 token 同值`, () => {
      const palette = THEME_PALETTE[mode] as Record<string, string>
      for (const [field, token] of Object.entries(MAPPING)) {
        expect(palette[field], `${mode}.${field} 应等于 --${token}`).toBe(tokens.get(token))
      }
    })
  }

  it('navFront 按约定取纯黑/纯白（不跟 --color-text）', () => {
    expect(THEME_PALETTE.light.navFront).toBe('#000000')
    expect(THEME_PALETTE.dark.navFront).toBe('#ffffff')
  })

  for (const mode of ['light', 'dark'] as const) {
    it(`${mode}：写死的 placeholder 色 = --color-text-muted`, () => {
      const tokens = mode === 'light' ? light : dark
      expect(PLACEHOLDER_COLOR[mode]).toBe(tokens.get('color-text-muted'))
    })
  }
})

describe('theme.json 的原生窗口配色与 token / palette 一致', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`${mode}：窗口底色 = page-bg（否则下拉回弹露色带）`, () => {
      const tokens = mode === 'light' ? light : dark
      expect(readThemeJson()[mode].backgroundColor).toBe(tokens.get('color-page-bg'))
      expect(readThemeJson()[mode].backgroundColor).toBe(THEME_PALETTE[mode].windowBg)
    })

    it(`${mode}：导航栏底色 = palette.navBg`, () => {
      expect(readThemeJson()[mode].navigationBarBackgroundColor).toBe(THEME_PALETTE[mode].navBg)
    })
  }
})

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
