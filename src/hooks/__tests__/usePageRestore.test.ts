import { describe, expect, it, vi } from 'vitest'
import { usePageRestore } from '../usePageRestore'

// router 由用例摆布：模拟「带参进入」与「页面重建后 params 为空」
const routerRef: { current: { path?: string; params?: Record<string, string> } | undefined } = {
  current: undefined,
}

vi.mock('@tarojs/taro', () => ({
  default: { getCurrentInstance: () => ({ router: routerRef.current }) },
}))

// 缓存是模块级、按页面路径共享，每个用例换一个路径以免互相污染
let seq = 0
const freshPath = () => `pages/test-${++seq}/index`

function enter(path: string, params?: Record<string, string>) {
  routerRef.current = { path, params }
}

describe('usePageRestore', () => {
  it('带参进入时返回该参数', () => {
    enter(freshPath(), { id: '42' })
    expect(usePageRestore<string>('id')).toBe('42')
  })

  it('参数丢失（页面重建）后回落到上次缓存的值', () => {
    const path = freshPath()
    enter(path, { id: '42', start: '2026-09-28' })
    expect(usePageRestore<string>('id')).toBe('42')

    // 重建：同路径重新进入，但 params 空了
    enter(path, undefined)
    expect(usePageRestore<string>('id')).toBe('42')
    // 缓存的是整份 params：没被读过的 start 也还在（按需缓存会漏掉它）
    expect(usePageRestore<string>('start')).toBe('2026-09-28')
  })

  it('再次带参进入时以后者为准', () => {
    const path = freshPath()
    enter(path, { id: '1' })
    expect(usePageRestore<string>('id')).toBe('1')
    enter(path, { id: '2' })
    expect(usePageRestore<string>('id')).toBe('2')
  })

  it('不同页面路径的缓存互不干扰', () => {
    const pathA = freshPath()
    const pathB = freshPath()
    enter(pathA, { id: 'A' })
    usePageRestore<string>('id')
    enter(pathB, { id: 'B' })
    usePageRestore<string>('id')

    enter(pathA, undefined)
    expect(usePageRestore<string>('id')).toBe('A')
  })

  it('从未出现过的参数返回 undefined', () => {
    enter(freshPath(), { id: '1' })
    expect(usePageRestore<string>('missing')).toBeUndefined()
  })
})
