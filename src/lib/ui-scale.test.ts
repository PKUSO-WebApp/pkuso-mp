import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  TAB_BAR_HEIGHT_PX,
  UI_BASE_WIDTH,
  UI_SCALE_FACTOR,
  UI_SCALE_KEY,
  UI_SCALE_OPTIONS,
  isUiScale,
  readStoredUiScale,
  tabBarHeightPx,
  tabBarReserveCss,
  uiScaleClass,
  uiScaleFactor,
  uiScaleLabel,
  writeUiScale,
} from './ui-scale'

/** 存储桩：`readStoredUiScale` 只认 `getStorageSync` 的返回值 */
const storage: Record<string, unknown> = {}

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: (k: string) => storage[k],
    setStorageSync: (k: string, v: unknown) => {
      storage[k] = v
    },
  },
}))

beforeEach(() => {
  for (const k of Object.keys(storage)) delete storage[k]
})

describe('档位与系数', () => {
  it('三档，且默认（没写过 / 存坏了）一律是标准', () => {
    expect(UI_SCALE_OPTIONS).toEqual(['compact', 'normal', 'large', 'xlarge'])
    expect(readStoredUiScale()).toBe('normal')

    storage[UI_SCALE_KEY] = 'huge'
    expect(readStoredUiScale()).toBe('normal')
    storage[UI_SCALE_KEY] = 42
    expect(readStoredUiScale()).toBe('normal')
  })

  it('写进去就读得回来（换档后重进 App 仍生效）', () => {
    writeUiScale('large')
    expect(storage[UI_SCALE_KEY]).toBe('large')
    expect(readStoredUiScale()).toBe('large')
  })

  it('系数：标准 = 1，紧凑更小、宽松更大', () => {
    expect(uiScaleFactor('normal')).toBe(1)
    expect(uiScaleFactor('compact')).toBeLessThan(1)
    expect(uiScaleFactor('large')).toBeGreaterThan(1)
  })

  it('isUiScale 只认那三个值', () => {
    expect(isUiScale('compact')).toBe(true)
    expect(isUiScale('normal')).toBe(true)
    expect(isUiScale('large')).toBe(true)
    expect(isUiScale('xlarge')).toBe(true)
    expect(isUiScale('')).toBe(false)
    expect(isUiScale(undefined)).toBe(false)
  })

  it('页根类名带上档位（CSS 的 --ui-k 从它来）', () => {
    expect(uiScaleClass('normal')).toBe('ui-scale ui-k-normal')
    expect(uiScaleClass('compact')).toContain('ui-k-compact')
  })

  it('选项文案就是倍率本身（用户定：不用「紧凑/标准」这类形容词）', () => {
    expect(UI_SCALE_OPTIONS.map(uiScaleLabel)).toEqual(['0.85x', '1.00x', '1.25x', '1.50x'])
  })
})

describe('底边栏高度（页面根的预留必须与它同源）', () => {
  it('标准档 = 50px，档位直接乘在上面', () => {
    expect(tabBarHeightPx(1)).toBe(TAB_BAR_HEIGHT_PX)
    expect(tabBarHeightPx(UI_SCALE_FACTOR.large)).toBe(50 * UI_SCALE_FACTOR.large)
  })

  it('预留串里带上算好的高度与安全区（类里的 px 会被转 rpx，只能内联）', () => {
    expect(tabBarReserveCss(1)).toBe('calc(50px + env(safe-area-inset-bottom))')
    expect(tabBarReserveCss(0.85)).toContain('42.5px')
    expect(tabBarReserveCss(1.25)).toContain('62.5px')
  })

  it('不出现浮点毛刺（页面与底边栏各自算高度，差一位小数就会差出 1px 空隙）', () => {
    for (const f of [0.85, 1, 1.25, 0.83, 0.68]) {
      expect(String(tabBarHeightPx(f))).not.toMatch(/\d{4,}/)
    }
  })
})

describe('基准宽度', () => {
  it('375pt 是设计稿基准（该宽度下 1rpx = 0.5px）', () => {
    expect(UI_BASE_WIDTH).toBe(375)
  })
})
