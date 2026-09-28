import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getOverlayOpen, setOverlayOpen, subscribeOverlayOpen } from './overlayStore'

// overlayStore 的计数是模块级状态，用例之间必须复位（每个用例成对开关）
beforeEach(() => {
  while (getOverlayOpen()) setOverlayOpen(false)
})

describe('overlayStore', () => {
  it('打开置真、关闭置假', () => {
    expect(getOverlayOpen()).toBe(false)
    setOverlayOpen(true)
    expect(getOverlayOpen()).toBe(true)
    setOverlayOpen(false)
    expect(getOverlayOpen()).toBe(false)
  })

  it('嵌套打开时，关掉一层仍为「有覆盖层」', () => {
    setOverlayOpen(true)
    setOverlayOpen(true)
    setOverlayOpen(false)
    expect(getOverlayOpen()).toBe(true)
    setOverlayOpen(false)
    expect(getOverlayOpen()).toBe(false)
  })

  it('多关一次不会把计数带成负数（下次打开仍正常）', () => {
    setOverlayOpen(false)
    setOverlayOpen(false)
    setOverlayOpen(true)
    expect(getOverlayOpen()).toBe(true)
    setOverlayOpen(false)
    expect(getOverlayOpen()).toBe(false)
  })

  it('嵌套打开不重复广播——广播发生在派生布尔翻转时，而不是每次计数变化', () => {
    const listener = vi.fn()
    subscribeOverlayOpen(listener)

    setOverlayOpen(true) // false → true：广播
    setOverlayOpen(true) // 仍为 true：不广播
    expect(listener).toHaveBeenCalledTimes(1)

    setOverlayOpen(false) // 仍为 true：不广播
    expect(listener).toHaveBeenCalledTimes(1)

    setOverlayOpen(false) // true → false：广播
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
