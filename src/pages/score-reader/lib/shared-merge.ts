import { supabase } from '@/lib/supabase'
import { loadAnnoDoc, saveAnnoDoc, type AnnoDoc, type AnnoStroke } from '@/lib/annotation'
import { markAnnoPending, mergeStrokes, pageFingerprint, strokeKey } from '@/lib/annotation-sync'
import {
  currentUserId,
  loadConflictPages,
  scheduleAnnotationSync,
  syncAnnotationFile,
} from '@/lib/annotation-sync-runner'

/** P6c：个人层 ↔ 共享层的双向合并（不新增表/RPC，全部复用 P5' 的 CAS） */

export type MergeDirection = 'to-personal' | 'to-shared'

/** 两侧的版本：`local` = 个人层，`shared` = 共享层，`merge` = 并集 */
export type MergeChoice = 'local' | 'shared' | 'merge'

export type MergePageState = {
  personal: AnnoStroke[]
  shared: AnnoStroke[]
  sharedVersion: string | null
}

export type MergePagesResult =
  | { ok: true; pages: number[] }
  | {
      ok: false
      reason: 'no-user' | 'sync-failed' | 'personal-conflicts' | 'not-allowed' | 'load-failed'
      /** personal-conflicts 时是待解决的页 */
      pages?: number[]
    }

export type MergeApplyResult =
  | { ok: true; changed: boolean; addedStrokes: number }
  | { ok: false; reason: 'no-user' | 'raced' | 'failed' }

const TABLE = 'sheet_music_shared_annotations'

const hasInk = (strokes: AnnoStroke[]): boolean =>
  strokes.some((s) => Array.isArray(s?.points) && s.points.length > 0)

/** 结果里有、原本没有的笔迹数（多重集差；同一笔重复画两次算两笔） */
export function countNewStrokes(before: AnnoStroke[], after: AnnoStroke[]): number {
  const counts = new Map<string, number>()
  for (const s of before) {
    const k = strokeKey(s)
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let added = 0
  for (const s of after) {
    const k = strokeKey(s)
    if (!k) continue
    const n = counts.get(k) ?? 0
    if (n > 0) counts.set(k, n - 1)
    else added++
  }
  return added
}

/**
 * 需要用户做选择的页：两侧指纹不同、且至少一侧有非空笔迹。
 * 未列出的页一律不动。
 */
export function mergePageNumbers(personal: AnnoDoc, shared: Map<number, AnnoStroke[]>): number[] {
  const pages = new Set<number>()
  for (const key of Object.keys(personal)) {
    const p = Number(key)
    if (Number.isInteger(p) && p >= 1) pages.add(p)
  }
  for (const p of shared.keys()) pages.add(p)
  return [...pages]
    .sort((a, b) => a - b)
    .filter((page) => {
      const a = personal[String(page)] ?? []
      const b = shared.get(page) ?? []
      if (!hasInk(a) && !hasInk(b)) return false
      return pageFingerprint(a) !== pageFingerprint(b)
    })
}

async function fetchSharedPages(
  fileId: string
): Promise<Map<number, { strokes: AnnoStroke[]; version: string | null }>> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('page, strokes, version')
    .eq('file_id', fileId)
  if (error) throw new Error(error.message)
  const out = new Map<number, { strokes: AnnoStroke[]; version: string | null }>()
  for (const row of (data ?? []) as { page: number; strokes: unknown; version: string | null }[]) {
    if (!Number.isInteger(row.page) || row.page < 1) continue
    out.set(row.page, {
      strokes: (Array.isArray(row.strokes) ? row.strokes : []) as AnnoStroke[],
      version: typeof row.version === 'string' && row.version ? row.version : null,
    })
  }
  return out
}

/**
 * 进合并前的准备：先把个人层对一次账（否则可能拿一份过期的本地去合并），
 * 再按方向检查权限/个人冲突，最后算差异页。
 */
export async function loadMergePages(
  fileId: string,
  direction: MergeDirection
): Promise<MergePagesResult> {
  const userId = await currentUserId()
  if (!userId) return { ok: false, reason: 'no-user' }

  const sync = await syncAnnotationFile(fileId)
  if (sync.status === 'failed') return { ok: false, reason: 'sync-failed' }
  if (sync.status === 'skipped') return { ok: false, reason: 'no-user' }

  if (direction === 'to-personal') {
    // 个人层还没解决的冲突优先：拿一份「还在分叉」的内容去合并没有意义
    const conflicts = await loadConflictPages(fileId)
    if (conflicts.length > 0) return { ok: false, reason: 'personal-conflicts', pages: conflicts }
  } else {
    const { data, error } = await supabase.rpc('can_edit_shared_annotation', {
      p_file_id: fileId,
    })
    if (error) return { ok: false, reason: 'load-failed' }
    if (!data) return { ok: false, reason: 'not-allowed' }
  }

  const personal = loadAnnoDoc(userId, fileId)
  let shared: Map<number, { strokes: AnnoStroke[]; version: string | null }>
  try {
    shared = await fetchSharedPages(fileId)
  } catch {
    return { ok: false, reason: 'load-failed' }
  }
  const sharedStrokes = new Map<number, AnnoStroke[]>(
    [...shared.entries()].map(([page, v]) => [page, v.strokes])
  )
  return { ok: true, pages: mergePageNumbers(personal, sharedStrokes) }
}

/** 单页预览：个人层那一页 + 共享层那一页（含共享版本，提交时做 CAS） */
export async function loadMergePage(fileId: string, page: number): Promise<MergePageState> {
  const userId = await currentUserId()
  if (!userId) throw new Error('no-user')
  const personal = loadAnnoDoc(userId, fileId)[String(page)] ?? []
  const { data, error } = await supabase
    .from(TABLE)
    .select('strokes, version')
    .eq('file_id', fileId)
    .eq('page', page)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return {
    personal,
    shared: (Array.isArray(data?.strokes) ? data?.strokes : []) as AnnoStroke[],
    sharedVersion: typeof data?.version === 'string' && data.version ? data.version : null,
  }
}

/** 两侧的选择语义与方向无关：local 永远指个人层，shared 永远指共享层 */
const targetOf = (choice: MergeChoice, preview: MergePageState): AnnoStroke[] => {
  if (choice === 'local') return preview.personal
  if (choice === 'shared') return preview.shared
  return mergeStrokes(preview.personal, preview.shared)
}

/**
 * 应用一页的选择。
 *
 * - to-personal：写**个人层**（先复核预览后个人页没变，否则 `raced`）；
 * - to-shared：以预览时的共享版本做 CAS 写**共享表**（个人层只读），冲突即 `raced`。
 */
export async function applyMergePage(args: {
  fileId: string
  page: number
  direction: MergeDirection
  choice: MergeChoice
  preview: MergePageState
}): Promise<MergeApplyResult> {
  const { fileId, page, direction, choice, preview } = args
  const userId = await currentUserId()
  if (!userId) return { ok: false, reason: 'no-user' }

  // 「保持不变」是纯粹的无操作：不写任何东西，也就不该被预览后的本地变化判成 raced
  if (direction === 'to-personal' && choice === 'local') {
    return { ok: true, changed: false, addedStrokes: 0 }
  }
  if (direction === 'to-shared' && choice === 'shared') {
    return { ok: true, changed: false, addedStrokes: 0 }
  }

  const currentPersonal = loadAnnoDoc(userId, fileId)[String(page)] ?? []
  // 预览之后本地若被后台同步改过，这一页的选择就过期了 —— 不拿旧选择套新内容
  if (pageFingerprint(currentPersonal) !== pageFingerprint(preview.personal)) {
    return { ok: false, reason: 'raced' }
  }

  const target = targetOf(choice, preview)

  if (direction === 'to-personal') {
    const before = currentPersonal
    const changed = pageFingerprint(target) !== pageFingerprint(before)
    if (!changed) return { ok: true, changed: false, addedStrokes: 0 }

    const doc: AnnoDoc = { ...loadAnnoDoc(userId, fileId) }
    doc[String(page)] = target
    if (!saveAnnoDoc(userId, fileId, doc)) return { ok: false, reason: 'failed' }
    markAnnoPending(userId)
    scheduleAnnotationSync(fileId)
    return { ok: true, changed: true, addedStrokes: countNewStrokes(before, target) }
  }

  // to-shared：共享层与预览一样就不写（不产生无意义的覆盖与历史版本）
  if (pageFingerprint(target) === pageFingerprint(preview.shared)) {
    return { ok: true, changed: false, addedStrokes: 0 }
  }
  const { data, error } = await supabase.rpc('push_shared_sheet_music_annotation', {
    p_file_id: fileId,
    p_page: page,
    p_strokes: target as never,
    p_expected_version: preview.sharedVersion ?? '',
  })
  const row = (data as { ok: boolean }[] | null)?.[0]
  if (error || !row) return { ok: false, reason: 'failed' }
  if (!row.ok) return { ok: false, reason: 'raced' }
  return {
    ok: true,
    changed: true,
    addedStrokes: countNewStrokes(preview.shared, target),
  }
}

/**
 * 批量契约（数据模型 §8.3 / §12.5）。逐页调用单页实现，**不是原子操作**：
 * 中途遇到 raced/失败就停，已应用的页保留（返回值如实报告）。
 */
export async function applySharedMerge(
  fileId: string,
  choices: Record<number, MergeChoice>
): Promise<{ ok: boolean; appliedPages: number; addedStrokes: number; racedPages: number[] }> {
  let appliedPages = 0
  let addedStrokes = 0
  const racedPages: number[] = []
  for (const [key, choice] of Object.entries(choices)) {
    const page = Number(key)
    if (!Number.isInteger(page) || page < 1) continue
    const preview = await loadMergePage(fileId, page)
    const result = await applyMergePage({
      fileId,
      page,
      direction: 'to-personal',
      choice,
      preview,
    })
    if (!result.ok) {
      if (result.reason === 'raced') racedPages.push(page)
      else return { ok: false, appliedPages, addedStrokes, racedPages }
      continue
    }
    if (result.changed) appliedPages++
    addedStrokes += result.addedStrokes
  }
  return { ok: racedPages.length === 0, appliedPages, addedStrokes, racedPages }
}

export async function applyPersonalToShared(
  fileId: string,
  choices: Record<number, MergeChoice>
): Promise<{ ok: boolean; appliedPages: number; racedPages: number[] }> {
  let appliedPages = 0
  const racedPages: number[] = []
  for (const [key, choice] of Object.entries(choices)) {
    const page = Number(key)
    if (!Number.isInteger(page) || page < 1) continue
    const preview = await loadMergePage(fileId, page)
    const result = await applyMergePage({
      fileId,
      page,
      direction: 'to-shared',
      choice,
      preview,
    })
    if (!result.ok) {
      if (result.reason === 'raced') racedPages.push(page)
      else return { ok: false, appliedPages, racedPages }
      continue
    }
    if (result.changed) appliedPages++
  }
  return { ok: racedPages.length === 0, appliedPages, racedPages }
}
