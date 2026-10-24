import type { SharedScoreFileRow } from '@/types/database'
import { pinyinSortKey } from './pinyin-sort'

/**
 * 共享谱的展示分组（P6b 验收修订）：
 *   曲子 → 声部 → 谱子（一个声部可以有多个文件，每个文件各有自己的共享版本）。
 *
 * 总谱暂不参与共享（用户 2026-10-24 定）：视图里即使有总谱的批注行，也不在共享入口出现。
 */
export const isSharedScoreRow = (row: SharedScoreFileRow): boolean =>
  (row.section ?? '').trim() !== '总谱'

export type SharedScoreGroup = {
  /** score_id 缺失时用标题兜底（正常视图两列都有） */
  key: string
  scoreId: string | null
  title: string
  files: SharedScoreFileRow[]
  sections: string[]
}

/** 按曲子聚合共享文件；不修改入参 */
export function groupSharedFilesByScore(rows: SharedScoreFileRow[]): SharedScoreGroup[] {
  const groups = new Map<string, SharedScoreGroup>()
  for (const row of rows) {
    if (!isSharedScoreRow(row)) continue
    const scoreId = row.score_id ?? null
    const title = (row.title ?? '').trim()
    const key = scoreId ?? `title:${title}`
    let group = groups.get(key)
    if (!group) {
      group = { key, scoreId, title, files: [], sections: [] }
      groups.set(key, group)
    }
    group.files.push(row)
    const section = (row.section ?? '').trim()
    if (section && !group.sections.includes(section)) group.sections.push(section)
  }
  return [...groups.values()].sort((a, b) => {
    const ka = pinyinSortKey(a.title)
    const kb = pinyinSortKey(b.title)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
}

/** 共享文件的 id 集合（详情/声部页据此过滤文件） */
export function sharedFileIds(rows: SharedScoreFileRow[]): Set<string> {
  return new Set(
    rows
      .filter(isSharedScoreRow)
      .map((row) => row.file_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  )
}
