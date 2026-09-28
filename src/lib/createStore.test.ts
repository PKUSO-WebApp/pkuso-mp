// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createStore, useStore } from './createStore'

describe('createStore', () => {
  it('get 返回初值', () => {
    expect(createStore(7).get()).toBe(7)
  })

  it('set 后读到新值，订阅者收到通知', () => {
    const store = createStore(0)
    const listener = vi.fn()
    store.subscribe(listener)

    store.set(1)

    expect(store.get()).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('set 成相等的值不广播——收敛前 5 份手抄实现在这点上不一致', () => {
    const store = createStore(false)
    const listener = vi.fn()
    store.subscribe(listener)

    store.set(false)

    expect(listener).not.toHaveBeenCalled()
  })

  it('多个订阅者都会收到；退订后不再收到', () => {
    const store = createStore(0)
    const a = vi.fn()
    const b = vi.fn()
    store.subscribe(a)
    const unsubscribeB = store.subscribe(b)

    store.set(1)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)

    unsubscribeB()
    store.set(2)
    expect(a).toHaveBeenCalledTimes(2)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('subscribe 返回的退订函数是幂等的', () => {
    const store = createStore(0)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()
    unsubscribe()
    store.set(1)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('useStore', () => {
  it('set 后让订阅组件重渲染并读到新值', () => {
    const store = createStore('a')
    const { result } = renderHook(() => useStore(store))
    expect(result.current).toBe('a')

    act(() => {
      store.set('b')
    })

    expect(result.current).toBe('b')
  })

  it('无关的 set（值相等）不触发重渲染', () => {
    const store = createStore(1)
    let renders = 0
    renderHook(() => {
      renders += 1
      return useStore(store)
    })
    const before = renders

    act(() => {
      store.set(1)
    })

    expect(renders).toBe(before)
  })
})
