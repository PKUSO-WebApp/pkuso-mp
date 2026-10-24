import { supabase } from '@/lib/supabase'
import type { AnnoStroke } from '@/lib/annotation'

/**
 * 云端**历史**的读侧（写侧只有服务端：推送 RPC 覆盖时自动归档，客户端只调 `archive_...`）。
 *
 * `sheet_music_annotation_history` 按页存「被覆盖掉的那一份」，每页留最近 N 版
 * （见 pkuso-backend 的 `20261014150000_sheet_music_annotation_versions.sql`）。
 * 它存在的意义就是这里：**选错了还能切回来** —— 冲突页里选了一版、或误覆盖/误删之后，
 * 用户能从「分享 → 恢复云端历史」把某一版找回来。
 *
 * ⚠️ 两级取数**刻意分开**（不是偷懒）：
 *   · 一级（批次列表）只取**元数据**（页 / 版本号 / 时刻）—— `strokes` 单行上限 256KB，
 *     整册一次拉回来能到几 MB，小程序端不值得；
 *   · 二级（点进某一批）才把那一批的内容拉回来，并在这里筛掉「没有笔迹」的行
 *     （归档几乎总是有内容的那一份，但**不假设**，按内容判）。
 */

export type HistorySource = 'personal' | 'shared'

const HISTORY_TABLES: Record<HistorySource, string> = {
  personal: 'sheet_music_annotation_history',
  shared: 'sheet_music_shared_annotation_history',
}

/** 历史里的一页（一级列表用，**不含内容**） */
export type HistoryEntry = {
  page: number
  /** 被覆盖掉那一份的版本号（服务端生成列 `md5(strokes)`）—— 恢复时按它取回内容 */
  version: string
  replacedAt: string
}

/**
 * 相邻两条归档相隔多久算「另一次覆盖」。
 *
 * 一次同步里的归档都挤在同一秒内，而「一页一页手动解决冲突」会慢得多 ⇒ 2 分钟：
 * 既不会把一次同步拆成两批，也不会把隔了几分钟的两件事糊成一批。
 */
export const BATCH_GAP_MS = 2 * 60 * 1000

export type HistoryBatch = {
  /** 这一批里**最新**那条的时刻（列表就按它排序/显示） */
  at: string
  entries: HistoryEntry[]
}

/**
 * 把归档行按「一次覆盖」聚成批（纯函数，有用例）。
 *
 * 为什么需要它：历史表是**按页**存的，而一次同步会同时归档好几页 —— 用户要的是
 * 「那一次覆盖涉及了哪些页」。判据用**相邻两条的间隔**，不按整分钟切：切法不该依赖
 * 「归档恰好发生在整点」这种巧合。
 *
 * 不改入参（内部先复制再排），`at` 取降序后这一批的第一条。
 */
export function groupHistoryBatches(rows: HistoryEntry[], gapMs = BATCH_GAP_MS): HistoryBatch[] {
  const sorted = [...rows].sort((a, b) =>
    a.replacedAt < b.replacedAt ? 1 : a.replacedAt > b.replacedAt ? -1 : 0
  )
  const out: HistoryBatch[] = []
  for (const row of sorted) {
    const cur = out[out.length - 1]
    if (cur && Date.parse(cur.at) - Date.parse(row.replacedAt) <= gapMs) {
      cur.entries.push(row)
    } else {
      out.push({ at: row.replacedAt, entries: [row] })
    }
  }
  return out
}

/**
 * 这一册的全部归档行（**不含内容**）。
 * 失败返回空数组而不是抛错：面板显示空态/失败态即可，不该把阅读器带崩。
 */
export async function listAnnotationHistory(
  fileId: string,
  source: HistorySource = 'personal'
): Promise<HistoryEntry[]> {
  // 表名是二选一的闭集，但 typed client 不接受动态 relation ⇒ 只在这一层放宽
  const db = supabase as unknown as { from: (table: string) => any }
  const { data, error } = await db
    .from(HISTORY_TABLES[source])
    .select('page, version, replaced_at')
    .eq('file_id', fileId)
    .order('replaced_at', { ascending: false })
  if (error) return []
  const rows = (data ?? []) as Array<{
    page: number
    version: string | null
    replaced_at: string | null
  }>
  return rows.map((row) => ({
    page: row.page,
    version: String(row.version ?? ''),
    replacedAt: String(row.replaced_at ?? ''),
  }))
}

export type HistoryPage = { entry: HistoryEntry; strokes: AnnoStroke[] }

/**
 * 某一批里**有笔迹**的页（二级列表用）。
 *
 * ⚠️ 按 `replaced_at` 的**区间**取、再按这一批的时刻集合**逐条核对**：只用 `version`
 * 过滤会把「别的页碰巧存过同一份内容」也捞进来（主键是 `file_id+user_id+page+version`，
 * 版本号本身不跨页唯一）。
 */
export async function loadHistoryBatch(
  fileId: string,
  batch: HistoryBatch,
  source: HistorySource = 'personal'
): Promise<HistoryPage[]> {
  const times = batch.entries.map((e) => e.replacedAt)
  if (times.length === 0) return []
  const wanted = new Set(times)
  const lo = times.reduce((a, b) => (a < b ? a : b))
  const hi = times.reduce((a, b) => (a > b ? a : b))
  // 表名是二选一的闭集，但 typed client 不接受动态 relation ⇒ 只在这一层放宽
  const db = supabase as unknown as { from: (table: string) => any }
  const { data, error } = await db
    .from(HISTORY_TABLES[source])
    .select('page, version, replaced_at, strokes')
    .eq('file_id', fileId)
    .gte('replaced_at', lo)
    .lte('replaced_at', hi)
  if (error) return []
  const rows = (data ?? []) as Array<{
    page: number
    version: string | null
    replaced_at: string | null
    strokes: unknown
  }>
  return rows
    .filter((row) => wanted.has(String(row.replaced_at ?? '')))
    .map((row) => ({
      entry: {
        page: row.page,
        version: String(row.version ?? ''),
        replacedAt: String(row.replaced_at ?? ''),
      },
      strokes: (Array.isArray(row.strokes) ? row.strokes : []) as unknown as AnnoStroke[],
    }))
    .filter((x) => x.strokes.length > 0)
    .sort((a, b) => a.entry.page - b.entry.page)
}

/**
 * 取回一页的**某一个历史版本**（冲突页的对照侧）。
 * 取不到返回 null —— 调用方按「失败」处理（宁可让用户重试，也不要拿一份空内容去对照）。
 */
export async function fetchArchivePage(
  fileId: string,
  page: number,
  version: string,
  source: HistorySource = 'personal'
): Promise<AnnoStroke[] | null> {
  // 表名是二选一的闭集，但 typed client 不接受动态 relation ⇒ 只在这一层放宽
  const db = supabase as unknown as { from: (table: string) => any }
  const { data, error } = await db
    .from(HISTORY_TABLES[source])
    .select('strokes')
    .eq('file_id', fileId)
    .eq('page', page)
    .eq('version', version)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { strokes?: unknown }
  return (Array.isArray(row.strokes) ? row.strokes : []) as unknown as AnnoStroke[]
}
