import { describe, expect, it } from 'vitest'
import { filterSharedScoreFiles, type SharedScoreScope } from './shared-scores'

type Row = { file_id: string; section: string | null; annotated_pages: number | null }

const row = (file_id: string, section: string | null, annotated_pages: number | null): Row => ({
  file_id,
  section,
  annotated_pages,
})

const files: Row[] = [
  row('mine-empty', '小提琴', 0),
  row('mine-anno', '小提琴', 3),
  row('other-anno', '中提琴', 2),
  row('other-empty', '中提琴', null),
  row('blank-section', '', 1),
]

const scope = (managedSections: string[], canManageAll = false): SharedScoreScope => ({
  managedSections,
  canManageAll,
})

describe('filterSharedScoreFiles', () => {
  it('有 shared_score 能力（团长/admin）：全部文件，不做任何过滤', () => {
    expect(filterSharedScoreFiles(files, scope([], true))).toEqual(files)
  })

  it('普通成员：只看有笔迹的文件（0 页 / null 都不显示）', () => {
    const visible = filterSharedScoreFiles(files, scope([]))
    expect(visible.map((f) => f.file_id)).toEqual(['mine-anno', 'other-anno', 'blank-section'])
  })

  it('声部长/首席：本作用域全部文件（含 0 页）+ 其他声部有笔迹的文件', () => {
    const visible = filterSharedScoreFiles(files, scope(['小提琴']))
    expect(visible.map((f) => f.file_id)).toEqual([
      'mine-empty',
      'mine-anno',
      'other-anno',
      'blank-section',
    ])
  })

  it('声部名两边都去掉首尾空白再比（库里可能有空格）', () => {
    const padded = [row('a', ' 小提琴 ', 0), row('b', '长笛', 0)]
    expect(filterSharedScoreFiles(padded, scope([' 小提琴 '])).map((f) => f.file_id)).toEqual(['a'])
  })

  it('管理范围里的空串不当作「匹配空声部」', () => {
    const visible = filterSharedScoreFiles(files, scope(['', '  ']))
    expect(visible.map((f) => f.file_id)).toEqual(['mine-anno', 'other-anno', 'blank-section'])
  })

  it('声部为 null / 空串且没有笔迹：不显示', () => {
    const visible = filterSharedScoreFiles([row('x', null, 0), row('y', '', 0)], scope([]))
    expect(visible).toEqual([])
  })
})
