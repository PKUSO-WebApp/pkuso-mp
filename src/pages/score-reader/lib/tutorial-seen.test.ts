import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSeenReaderTutorial, markReaderTutorialSeen, TUTORIAL_SEEN_KEY } from './tutorial-seen'

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

describe('阅读器教程的「已看过」标记', () => {
  it('没写过 = 没看过', () => {
    taro.getStorageSync.mockReturnValue('')
    expect(hasSeenReaderTutorial()).toBe(false)
  })

  it('写过 true = 看过', () => {
    taro.getStorageSync.mockReturnValue(true)
    expect(hasSeenReaderTutorial()).toBe(true)
  })

  it('存进去别的值（字符串 true / 0）都不算看过', () => {
    taro.getStorageSync.mockReturnValue('true')
    expect(hasSeenReaderTutorial()).toBe(false)
    taro.getStorageSync.mockReturnValue(0)
    expect(hasSeenReaderTutorial()).toBe(false)
  })

  it('读失败当没看过（宁可多展示一次）', () => {
    taro.getStorageSync.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(hasSeenReaderTutorial()).toBe(false)
  })

  it('写：用带版本的 key，写失败不抛（下次再展示）', () => {
    markReaderTutorialSeen()
    expect(taro.setStorageSync).toHaveBeenCalledWith(TUTORIAL_SEEN_KEY, true)
    taro.setStorageSync.mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => markReaderTutorialSeen()).not.toThrow()
  })
})
