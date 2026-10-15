import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isPenBarCollapsed,
  PEN_BAR_COLLAPSED_KEY,
  setPenBarCollapsed,
} from './pen-bar-collapsed'

// vi.mock 会被提升到文件顶部，工厂里不能引用普通顶层变量——用 vi.hoisted 一起提起
const taro = vi.hoisted(() => ({
  getStorageSync: vi.fn(),
  setStorageSync: vi.fn(),
}))
vi.mock('@tarojs/taro', () => ({ default: taro }))

beforeEach(() => {
  taro.getStorageSync.mockReset()
  taro.setStorageSync.mockReset()
})

describe('批注工具条的「收起」状态', () => {
  it('没写过 = 展开（宁可多显示一次工具条，也别让人找不到工具）', () => {
    taro.getStorageSync.mockReturnValue('')
    expect(isPenBarCollapsed()).toBe(false)
  })

  it('写过 true = 收起', () => {
    taro.getStorageSync.mockReturnValue(true)
    expect(isPenBarCollapsed()).toBe(true)
  })

  it('存进去别的值（字符串 true / 1）都不算收起', () => {
    taro.getStorageSync.mockReturnValue('true')
    expect(isPenBarCollapsed()).toBe(false)
    taro.getStorageSync.mockReturnValue(1)
    expect(isPenBarCollapsed()).toBe(false)
  })

  it('读失败当没收起', () => {
    taro.getStorageSync.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(isPenBarCollapsed()).toBe(false)
  })

  it('写：两个方向都落同一个带版本的 key，写失败不抛', () => {
    setPenBarCollapsed(true)
    expect(taro.setStorageSync).toHaveBeenCalledWith(PEN_BAR_COLLAPSED_KEY, true)
    setPenBarCollapsed(false)
    expect(taro.setStorageSync).toHaveBeenLastCalledWith(PEN_BAR_COLLAPSED_KEY, false)
    taro.setStorageSync.mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => setPenBarCollapsed(true)).not.toThrow()
  })
})
