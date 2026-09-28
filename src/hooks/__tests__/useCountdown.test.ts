// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCountdown } from '../useCountdown'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useCountdown', () => {
  it('初值为 0、未激活', () => {
    const { result } = renderHook(() => useCountdown(60))
    expect(result.current.countdown).toBe(0)
    expect(result.current.isActive).toBe(false)
  })

  it('start 后逐秒递减到 0 并自动停表', () => {
    const { result } = renderHook(() => useCountdown(60))

    act(() => result.current.start(3))
    expect(result.current.countdown).toBe(3)
    expect(result.current.isActive).toBe(true)

    act(() => vi.advanceTimersByTime(1000))
    expect(result.current.countdown).toBe(2)

    act(() => vi.advanceTimersByTime(2000))
    expect(result.current.countdown).toBe(0)
    expect(result.current.isActive).toBe(false)
    // 归零时把表清掉了，不该再有定时器在跑
    expect(vi.getTimerCount()).toBe(0)
  })

  it('start 不传秒数时用 defaultSeconds', () => {
    const { result } = renderHook(() => useCountdown(45))
    act(() => result.current.start())
    expect(result.current.countdown).toBe(45)
  })

  it('重复 start 不叠表：只按一只表的节奏递减', () => {
    const { result } = renderHook(() => useCountdown(60))

    act(() => result.current.start(10))
    act(() => vi.advanceTimersByTime(1000))
    act(() => result.current.start(10))
    act(() => vi.advanceTimersByTime(1000))

    expect(result.current.countdown).toBe(9)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('stop 立即归零并停表', () => {
    const { result } = renderHook(() => useCountdown(60))

    act(() => result.current.start(30))
    act(() => result.current.stop())

    expect(result.current.countdown).toBe(0)
    expect(vi.getTimerCount()).toBe(0)

    act(() => vi.advanceTimersByTime(5000))
    expect(result.current.countdown).toBe(0)
  })

  it('卸载时清理定时器', () => {
    const { result, unmount } = renderHook(() => useCountdown(60))
    act(() => result.current.start(30))
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
