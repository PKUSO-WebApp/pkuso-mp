import Taro from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { loadAnnoDoc, saveAnnoDoc, type AnnoDoc, type AnnoStroke } from '@/lib/annotation'
import {
  markAnnoPending,
  mergeStrokes,
  pageFingerprint,
  planSync,
  type RemotePage,
  type SyncBase,
} from '@/lib/annotation-sync'
import { scheduleAnnotationSync } from '@/lib/annotation-sync-runner'

/**
 * 0.6.1：其他人打开共享副本时，把 owner 的共享层**拉进自己的个人层**。
 *
 * 产品规则（2026-11-09 定）：
 *   · 打开时默认 pull，先拉 owner 的最新共享层；
 *   · 本地没动、共享层动了 ⇒ 直接收下；
 *   · 两边都动了（且互不包含）⇒ 交给用户三选一（local / remote / merge）；
 *   · 所有选择**只写个人层**（本地 + 个人云同步），永远不写共享层。
 *
 * 与现有 `annotation-sync-runner` 的分工：
 *   · runner 对账的是「个人层 ↔ 个人云」；
 *   · 本模块对账的是「个人层 ↔ owner 共享层」，复用 runner 的 `planSync` 三方判定，
 *     但把「推」的动作全部丢弃 —— 这里没有写共享层的权限。
 *
 * 基线（`share-pull-base-v1:<owner>:<shareId>`）记的是**上次拉到的共享层内容指纹 + 版本**，
 * 与个人云同步的基线是两个 namespace（同一个 `share:<id>` 文档键在两套同步里各有一份基线）。
 * 基线只存在本地：换设备后第一次打开会按「没有基线」处理，靠包含关系自动裁决；
 * 真分叉时最多多问一次，不会丢数据。
 */

export type SharePullConflict = {
  page: number
  local: AnnoStroke[]
  remote: AnnoStroke[]
  remoteVersion: string
}

export type SharePullResult = {
  /** 合并后的个人文档（未采纳时为原样） */
  doc: AnnoDoc
  /** 被收下的共享层页（落盘失败时为空：下一轮还要重新收） */
  adopted: number[]
  /** 需要用户选的真分叉 */
  conflicts: SharePullConflict[]
  /** 本地写盘失败（存储满）：基线不推进，下一轮重来 */
  saveFailed?: boolean
}

const BASE_PREFIX = 'share-pull-base-v1:'
const baseKey = (owner: string, shareId: string): string => `${BASE_PREFIX}${owner}:${shareId}`

function loadBase(owner: string, shareId: string): SyncBase {
  try {
    const raw = Taro.getStorageSync(baseKey(owner, shareId))
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as SyncBase) : {}
  } catch {
    return {}
  }
}

function saveBase(owner: string, shareId: string, base: SyncBase): void {
  try {
    Taro.setStorageSync(baseKey(owner, shareId), base)
  } catch {
    // 存储满：基线丢了最多下一次多问一次冲突，不能因此阻断阅读
  }
}

async function fetchSharePages(shareId: string): Promise<RemotePage[]> {
  // 表名是新增的、typed client 尚未重新生成时也要能编译；只在这一层放宽
  const db = supabase as unknown as { from: (table: string) => any }
  const { data, error } = await db
    .from('sheet_music_share_annotations')
    .select('page, strokes, version, updated_at')
    .eq('share_id', shareId)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<{
    page: number
    strokes: unknown
    version: string | null
    updated_at: string | null
  }>).map((row) => ({
    page: row.page,
    strokes: (Array.isArray(row.strokes) ? row.strokes : []) as unknown as AnnoStroke[],
    version: typeof row.version === 'string' && row.version ? row.version : null,
    updatedAt: Date.parse(String(row.updated_at ?? '')) || 0,
  }))
}

/**
 * 拉一次共享层并合并进个人层。调用方**必须**先等个人云同步落地
 * （`annotationBackend.onOpen()`），否则会拿一份还没对完账的本地内容去合并。
 */
export async function pullShareLayer(args: {
  owner: string
  shareId: string
  /** `share:<shareId>` */
  docKey: string
}): Promise<SharePullResult> {
  const { owner, shareId, docKey } = args
  const local = loadAnnoDoc(owner, docKey)
  const base = loadBase(owner, shareId)
  const remote = await fetchSharePages(shareId)
  const plan = planSync(local, base, remote)

  const remoteMap = new Map<number, { strokes: AnnoStroke[]; version: string | null }>()
  for (const row of remote) {
    remoteMap.set(row.page, { strokes: row.strokes, version: row.version })
  }

  const doc: AnnoDoc = { ...local }
  const adopted: number[] = []
  /** 拉取期间本地被改过、这一轮不收的页：基线也不能推进，下一轮重来 */
  const skipped = new Set<number>()
  for (const item of plan.toAdopt) {
    const key = String(item.page)
    if (pageFingerprint(doc[key] ?? []) !== item.localFp) {
      skipped.add(item.page)
      continue
    }
    doc[key] = item.strokes
    adopted.push(item.page)
  }

  const conflictSet = new Set(plan.conflicts)
  const conflicts: SharePullConflict[] = plan.conflicts.map((page) => ({
    page,
    local: doc[String(page)] ?? [],
    remote: remoteMap.get(page)?.strokes ?? [],
    remoteVersion: remoteMap.get(page)?.version ?? '',
  }))

  // 非冲突页的基线推进到**当前**共享层版本：这样「共享层没再变」的页不会反复弹冲突。
  // 冲突页保持旧基线，直到用户在冲突面板里做出选择。
  const pages = new Set<number>()
  for (const key of [...Object.keys(doc), ...Object.keys(base), ...remoteMap.keys()]) {
    const n = Number(key)
    if (Number.isInteger(n) && n >= 1) pages.add(n)
  }
  const nextBase: SyncBase = { ...base }
  for (const page of pages) {
    if (conflictSet.has(page) || skipped.has(page)) continue
    const r = remoteMap.get(page)
    nextBase[String(page)] = {
      fp: pageFingerprint(r?.strokes ?? []),
      version: r?.version ?? undefined,
    }
  }

  /**
   * 写盘失败（存储满）时**绝不能推进基线**：否则「共享层已收下」被记成事实，
   * 而本地其实没有这份内容——之后共享层没再变，就再也不会重新收，等于静默丢内容。
   * 本轮返回 adopted=[]，让阅读器保持原文档；下一轮按旧基线重算。
   */
  let saveFailed = false
  if (adopted.length > 0) {
    saveFailed = !saveAnnoDoc(owner, docKey, doc)
    if (!saveFailed) {
      markAnnoPending(owner)
      scheduleAnnotationSync(docKey)
    }
  }

  if (!saveFailed) saveBase(owner, shareId, nextBase)

  return {
    doc,
    adopted: saveFailed ? [] : adopted,
    conflicts,
    ...(saveFailed ? { saveFailed: true } : {}),
  }
}

export type SharePullChoice = 'local' | 'remote' | 'merge'

/** 共享层某一页现在的版本（冲突提交前复核：预览之后 owner 又 push 过就不能按旧版提交） */
async function fetchSharePageVersion(
  shareId: string,
  page: number
): Promise<{ found: boolean; version: string | null }> {
  const db = supabase as unknown as { from: (table: string) => any }
  const { data, error } = await db
    .from('sheet_music_share_annotations')
    .select('version')
    .eq('share_id', shareId)
    .eq('page', page)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return {
    found: !!data,
    version: typeof data?.version === 'string' && data.version ? data.version : null,
  }
}

/**
 * 解决一次「个人层 ↔ 共享层」冲突。**只写个人层**：
 *   · local  = 保留我的（共享层那份仍在共享表里，不丢）；
 *   · remote = 采纳共享层（先把我的那份送进个人层历史，误选还能找回）；
 *   · merge  = 两边取并集。
 * 三种选择都会把基线推进到这一版的共享层，避免同一版反复弹窗。
 *
 * 提交前复核共享层版本：预览之后 owner 又 push 过 ⇒ 返回 `raced`，让 UI 提示重新看一眼，
 * 而不是拿用户没见过的版本做选择。
 */
export async function resolveSharePullConflict(args: {
  owner: string
  shareId: string
  docKey: string
  conflict: SharePullConflict
  choice: SharePullChoice
}): Promise<{ ok: boolean; raced?: boolean; strokes: AnnoStroke[] | null }> {
  const { owner, shareId, docKey, conflict, choice } = args

  try {
    const now = await fetchSharePageVersion(shareId, conflict.page)
    const expected = conflict.remoteVersion || null
    if (now.version !== expected || now.found !== !!expected) {
      return { ok: false, raced: true, strokes: null }
    }
  } catch {
    // 复核失败按网络失败处理：不让用户在一个不确定的版本上提交
    return { ok: false, strokes: null }
  }

  const doc: AnnoDoc = { ...loadAnnoDoc(owner, docKey) }
  const key = String(conflict.page)
  const currentLocal = doc[key] ?? []

  let next: AnnoStroke[]
  if (choice === 'local') {
    next = currentLocal
  } else if (choice === 'remote') {
    // 服务端历史里留一份我的，选错了还能从「恢复云端历史」找回来
    try {
      await (supabase.rpc as any)('archive_share_user_annotation', {
        p_share_id: shareId,
        p_page: conflict.page,
        p_strokes: currentLocal as never,
      })
    } catch {
      // 历史是兜底，不是提交的前置条件：归档失败也要让用户继续
    }
    next = conflict.remote
  } else {
    next = mergeStrokes(currentLocal, conflict.remote)
  }

  if (pageFingerprint(currentLocal) !== pageFingerprint(next)) {
    doc[key] = next
    // 写盘失败就不能推进基线，否则「已解决」被记成事实而本地没有这份内容
    if (!saveAnnoDoc(owner, docKey, doc)) return { ok: false, strokes: null }
    markAnnoPending(owner)
    scheduleAnnotationSync(docKey)
  }

  const base = loadBase(owner, shareId)
  base[key] = {
    fp: pageFingerprint(conflict.remote),
    version: conflict.remoteVersion || undefined,
  }
  saveBase(owner, shareId, base)

  return { ok: true, strokes: next }
}
