import { describe, expect, it } from 'vitest'
import { formatRepertoireSummary } from './repertoire-summary'

describe('formatRepertoireSummary', () => {
  it('无内容时用顿号连接曲名', () => {
    expect(formatRepertoireSummary([{ title: '曲目 A' }, { title: '曲目 B', content: '' }])).toBe(
      '曲目 A、曲目 B'
    )
  })

  it('有内容时用分号分隔，并在曲名后接内容', () => {
    expect(
      formatRepertoireSummary([
        { title: '曲目 A', content: '第一乐章' },
        { title: '曲目 B', content: '' },
      ])
    ).toBe('曲目 A：第一乐章；曲目 B')
  })

  it('过滤空曲名并 trim', () => {
    expect(
      formatRepertoireSummary([
        { title: '  ', content: 'x' },
        { title: ' 曲目 A ', content: ' 第二乐章 ' },
      ])
    ).toBe('曲目 A：第二乐章')
  })

  it('空列表返回空串', () => {
    expect(formatRepertoireSummary([])).toBe('')
  })
})
