import { describe, expect, it } from 'vitest'
import {
  defaultSubPartNumbers,
  mergeSubPartOptions,
  resolveSubPartPolicy,
} from './sub-parts'

describe('resolveSubPartPolicy', () => {
  it('木管/铜管 = 有默认范围', () => {
    expect(resolveSubPartPolicy(['木管'])).toBe('range')
    expect(resolveSubPartPolicy(['铜管'])).toBe('range')
    expect(resolveSubPartPolicy(['管乐', '铜管'])).toBe('range')
  })

  it('弦乐 = 不区分分声部', () => {
    expect(resolveSubPartPolicy(['弦乐'])).toBe('none')
  })

  it('没有组的乐器（打击乐等）= 只给未设置', () => {
    expect(resolveSubPartPolicy([])).toBe('unset-only')
  })
})

describe('defaultSubPartNumbers', () => {
  it('管乐默认 1–4，其他类别没有默认值', () => {
    expect(defaultSubPartNumbers('range')).toEqual([1, 2, 3, 4])
    expect(defaultSubPartNumbers('none')).toEqual([])
    expect(defaultSubPartNumbers('unset-only')).toEqual([])
  })
})

describe('mergeSubPartOptions', () => {
  it('默认范围 ∪ 文件里出现过的更高号，去重升序', () => {
    expect(mergeSubPartOptions(null, [[5, 2]], [1, 2, 3, 4])).toEqual([1, 2, 3, 4, 5])
  })

  it('已有偏好即使不在默认范围/文件里也保留（可显示与清除）', () => {
    expect(mergeSubPartOptions(6, [[1]], [1, 2, 3, 4])).toEqual([1, 2, 3, 4, 6])
  })

  it('无默认范围时只保留文件号与当前值', () => {
    expect(mergeSubPartOptions(null, [[3, 1], null, undefined, []])).toEqual([1, 3])
    expect(mergeSubPartOptions(5, [[1]], [])).toEqual([1, 5])
  })

  it('忽略非正整数与非法值', () => {
    expect(mergeSubPartOptions(0, [[-1, 0, 1.5, 2]], [])).toEqual([2])
  })

  it('不改入参', () => {
    const files = [[3, 1]]
    mergeSubPartOptions(2, files, [1])
    expect(files).toEqual([[3, 1]])
  })
})
