import { describe, expect, it } from 'vitest'
import { clamp, clampPan, touchDist, touchMid } from './geometry'

describe('clamp', () => {
  it('夹在区间内', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })
})

describe('clampPan', () => {
  it('内容比视口小：该轴居中', () => {
    // 宽 100 高 100 的内容放进 300x200 视口 → 两轴都居中
    expect(clampPan({ x: -40, y: -40 }, 100, 100, 300, 200)).toEqual({ x: 100, y: 50 })
  })

  it('内容比视口大：该轴不许拉出空白（上限 0、下限 vw-w）', () => {
    // 宽 600 高 500 的内容放进 300x200 视口
    expect(clampPan({ x: 10, y: 10 }, 600, 500, 300, 200)).toEqual({ x: 0, y: 0 })
    expect(clampPan({ x: -999, y: -999 }, 600, 500, 300, 200)).toEqual({ x: -300, y: -300 })
  })

  it('两轴可以一个居中一个钳制', () => {
    // 宽 100（< 300 → 居中 x=100）、高 500（> 200 → 钳制）
    expect(clampPan({ x: 0, y: -50 }, 100, 500, 300, 200)).toEqual({ x: 100, y: -50 })
  })

  it('位置未变时返回同一个对象（引用相等，避免无谓重渲染）', () => {
    const p = { x: 0, y: 0 }
    expect(clampPan(p, 600, 500, 300, 200)).toBe(p)
  })

  it('视口尺寸为 0（尚未测量）时原样返回', () => {
    const p = { x: 7, y: 9 }
    expect(clampPan(p, 100, 100, 0, 0)).toBe(p)
  })
})

describe('touchDist / touchMid', () => {
  it('两点距离', () => {
    expect(
      touchDist([
        { clientX: 0, clientY: 0 },
        { clientX: 3, clientY: 4 },
      ])
    ).toBe(5)
  })

  it('两点中点', () => {
    expect(
      touchMid([
        { clientX: 0, clientY: 0 },
        { clientX: 10, clientY: 20 },
      ])
    ).toEqual([5, 10])
  })

  it('点数不足时给零值而不是抛错（单指 / 抬手瞬间都会走到这）', () => {
    expect(touchDist([{ clientX: 1, clientY: 1 }])).toBe(0)
    expect(touchDist([])).toBe(0)
    expect(touchMid([{ clientX: 1, clientY: 1 }])).toEqual([0, 0])
    expect(touchMid([])).toEqual([0, 0])
  })
})
