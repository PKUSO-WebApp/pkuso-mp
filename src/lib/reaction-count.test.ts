import { describe, expect, it } from 'vitest'
import { formatReactionCount, REACTION_INT_MAX } from './reaction-count'

describe('formatReactionCount', () => {
  it('千以内原样显示', () => {
    expect(formatReactionCount(0)).toBe('0')
    expect(formatReactionCount(99)).toBe('99')
    expect(formatReactionCount(999)).toBe('999')
  })

  it('千级用 x.xxk，且截断而非四舍五入', () => {
    expect(formatReactionCount(1000)).toBe('1.00k')
    expect(formatReactionCount(1234)).toBe('1.23k')
    expect(formatReactionCount(1299)).toBe('1.29k')
    // 关键边界：不能进位成 1000.00k
    expect(formatReactionCount(999_999)).toBe('999.99k')
  })

  it('百万级用 x.xxm', () => {
    expect(formatReactionCount(1_000_000)).toBe('1.00m')
    expect(formatReactionCount(1_234_567)).toBe('1.23m')
    expect(formatReactionCount(999_999_999)).toBe('999.99m')
  })

  it('十亿级用 x.xxb，超过 int4 max 按上限截断', () => {
    expect(formatReactionCount(1_000_000_000)).toBe('1.00b')
    expect(formatReactionCount(REACTION_INT_MAX)).toBe('2.14b')
    expect(formatReactionCount(REACTION_INT_MAX + 1000)).toBe('2.14b')
  })

  it('负数 / 非数字按 0', () => {
    expect(formatReactionCount(-1)).toBe('0')
    expect(formatReactionCount(Number.NaN)).toBe('0')
    expect(formatReactionCount(null)).toBe('0')
    expect(formatReactionCount(undefined)).toBe('0')
  })
})
