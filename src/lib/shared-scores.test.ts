import { describe, expect, it } from 'vitest'
import type { SharedScoreFileRow } from '@/types/database'
import { groupSharedFilesByScore, isSharedScoreRow, sharedFileIds } from './shared-scores'

const row = (over: Partial<SharedScoreFileRow>): SharedScoreFileRow =>
  ({
    file_id: 'f1',
    file_name: 'a.pdf',
    page_count: 3,
    file_instrument: null,
    sub_parts: null,
    section: '第一小提琴',
    score_id: 's1',
    title: '红旗颂',
    annotated_pages: 1,
    source_page_count: 3,
    updated_at: '2026-10-24T00:00:00Z',
    ...over,
  }) as SharedScoreFileRow

describe('shared-scores', () => {
  it('总谱不参与共享', () => {
    expect(isSharedScoreRow(row({ section: '总谱' }))).toBe(false)
    expect(isSharedScoreRow(row({ section: ' 总谱 ' }))).toBe(false)
    expect(isSharedScoreRow(row({ section: '第一小提琴' }))).toBe(true)
  })

  it('按曲子聚合，声部去重，文件全保留（同一声部多个谱子）', () => {
    const groups = groupSharedFilesByScore([
      row({ file_id: 'a', section: '第一小提琴' }),
      row({ file_id: 'b', section: '第一小提琴' }),
      row({ file_id: 'c', section: '第二小提琴' }),
      row({ file_id: 'd', section: '总谱' }),
      row({ file_id: 'e', score_id: 's2', title: '黄河' }),
    ])

    expect(groups.map((g) => [g.scoreId, g.files.map((f) => f.file_id)])).toEqual([
      ['s1', ['a', 'b', 'c']],
      ['s2', ['e']],
    ])
    expect(groups[0].sections).toEqual(['第一小提琴', '第二小提琴'])
  })

  it('sharedFileIds：过滤总谱并去掉空 id', () => {
    expect(
      [...sharedFileIds([
        row({ file_id: 'a' }),
        row({ file_id: 'b', section: '总谱' }),
        row({ file_id: null }),
      ])]
    ).toEqual(['a'])
  })
})
