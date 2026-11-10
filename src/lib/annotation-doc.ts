/**
 * 批注文档的键（0.6.1 共享副本）。
 *
 * 普通谱务文件用 `sheet_music_files.id`；共享副本用 `share:<share_id>`。
 * 本地 Storage、同步基线、冲突记录都以这个**字符串键**为作用域，
 * 云端则按 `kind` 选 `sheet_music_annotations` / `sheet_music_share_user_annotations`
 * 两张表（见 `annotation-sync-runner.ts`）。
 *
 * 为什么不在所有地方都改用对象：现有个人同步链路（全量扫描、欠账标记、历史）
 * 都以字符串键遍历本地 Storage；加前缀能保持旧键（裸 uuid）逐字兼容，改动面最小。
 */

export const SHARE_DOC_PREFIX = 'share:'

export type AnnotationDocRef =
  | { kind: 'file'; id: string }
  | { kind: 'share'; id: string }

/** 共享副本的本地文档键（也是 personal 后端的 `fileId` 参数） */
export const shareDocKey = (shareId: string): string => `${SHARE_DOC_PREFIX}${shareId}`

/** 解析文档键；不是 `share:` 前缀的一律当普通文件（旧数据/旧键） */
export function parseAnnotationDocKey(key: string): AnnotationDocRef {
  if (key.startsWith(SHARE_DOC_PREFIX)) {
    return { kind: 'share', id: key.slice(SHARE_DOC_PREFIX.length) }
  }
  return { kind: 'file', id: key }
}

export const isShareDocKey = (key: string): boolean => key.startsWith(SHARE_DOC_PREFIX)
