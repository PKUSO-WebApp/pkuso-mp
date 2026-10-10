import Taro from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { reportClientError } from '@/lib/error-report'
import { loadAnnoDoc, saveAnnoDoc, type AnnoDoc, type AnnoStroke } from '@/lib/annotation'
import {
  clearAnnoPending,
  isAnnoPending,
  listAnnotatedFileIds,
  loadMtime,
  loadSyncBase,
  planSync,
  saveSyncBase,
  type RemotePage,
} from '@/lib/annotation-sync'

/**
 * 批注上云的**网络那半边**：拉、推、以及把两者串起来的对账。
 *
 * 时序（「先拉后推」，三层判定的细节见 annotation-sync.ts 的 planSync）：
 *
 *   1. 拉这册的全部页
 *   2. 逐页三方比对（本地指纹 / 基线指纹 / 远端指纹）
 *       只有本地变 → 待上传      只有远端变 → 落回本地
 *       两边都变   → 冲突，两边都不动，只上报
 *   3. 只 upsert 待上传的页；**逐页确认**——推成功的页才写回基线
 *   4. 全部文件都对账确认后，才清全局欠账标记
 *
 * ## 推的时机（事件驱动，五处）
 *
 * ① 停笔后防抖（`scheduleAnnotationSync`，主路径）
 * ② 换册 / 离开阅读器（阅读器 useUnload 调 `flushAnnotationSync`）
 * ③ 进册（阅读器载入本地批注后调 `syncAnnotationFile`，这也是「上次被杀」的兜底）
 * ④ 联网恢复（本文件 `installAnnotationSync` 挂的 onNetworkStatusChange）
 * ⑤ 任意一次请求成功之后（app.ts 把 `syncAllAnnotationFiles` 挂在既有的 requestSuccessHook 上）
 *
 * ## 失败与断网：不检测网络，让失败自己成为信号
 *
 * 推失败 ⇒ **留账**（基线不推进）、什么都不做，等 ④/⑤ 来驱动下一次。刻意**不做**重试循环——
 * 那是白耗电，而「网通了」这个信号仓里已经有了。也**不**把欠账放进内存队列：进程一死就没了，
 * 而欠账本来就由「本地指纹 ≠ 基线」推导得出，不需要记住。
 *
 * ④ 与 ⑤ 是同一件事的两个信号源，都留着：一个显式、一个被动。⑤ 尤其重要——开发者工具里
 * 模拟离线**不会**触发 onNetworkStatusChange（本仓踩过，见 error-report 里的同名告诫）。
 */

const TABLE = 'sheet_music_annotations'

/** 停笔后多久推。太短会在连笔之间发一串请求，太长则「画完就退出」赶不上 */
const DEBOUNCE_MS = 2500

/**
 * 全量扫描的最小间隔。它挡的是这一种病：**某一册永远推不上去**（比如某页超了 256KB 护栏，
 * 服务端恒 400）。那册的欠账清不掉，于是之后每一次成功的请求都会再扫一遍全部册——
 * 有了这道闸，最多 5 秒一次，而不是每个成功请求一次。
 */
const SCAN_MIN_INTERVAL_MS = 5000

export type SyncResult = {
  status: 'ok' | 'skipped' | 'failed'
  pushed: number
  adopted: number
  conflicts: number
}

const SKIPPED: SyncResult = { status: 'skipped', pushed: 0, adopted: 0, conflicts: 0 }

/** 同一册同时只跑一次（防抖与联网恢复可能撞在一起） */
const inFlight = new Set<string>()

/**
 * 当前打开的阅读器要在「别处（全量扫描）把这册的内容落到本地」时同步刷新内存态，
 * 否则用户会盯着一份过期的画面。阅读器挂载时注册、卸载时注销。
 */
let adoptListener: ((fileId: string, doc: AnnoDoc) => void) | null = null

export function setAnnotationAdoptListener(fn: ((fileId: string, doc: AnnoDoc) => void) | null): void {
  adoptListener = fn
}

async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.user?.id ?? null
  } catch {
    return null
  }
}

async function fetchRemotePages(fileId: string): Promise<RemotePage[]> {
  // 不按 user_id 过滤：RLS 已经只给本人可见，多带一个条件只是重复一遍策略
  const { data, error } = await supabase
    .from(TABLE)
    .select('page, strokes, updated_at')
    .eq('file_id', fileId)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    page: row.page as number,
    strokes: (Array.isArray(row.strokes) ? row.strokes : []) as unknown as AnnoStroke[],
    // 服务端盖章的时刻（触发器写的），LWW 拿它跟本机那一页的改动时刻比
    updatedAt: Date.parse(String(row.updated_at ?? '')) || 0,
  }))
}

/**
 * 写一页。
 *
 * ⚠️ 这里用 `upsert` 而不是 `insert`：主键 (file_id, user_id, page) 让 upsert 天然幂等，
 * 「先拉后推」里同一页被推两次也无害。本仓有过一条相反的教训——**只给 INSERT、SELECT 限
 * 管理员**的表上，postgrest 的 upsert 必然被 RLS 拒成 42501（它的 upsert 路径要读回结果行）。
 * 本表不是那种形状：策略是 `FOR ALL ... USING (auth.uid() = user_id)`，读回自己那一行是允许的。
 * 真要出问题，表现为**每次推送都失败**（连着 pull 却正常），判据就是这条。
 */
async function pushRemotePage(
  fileId: string,
  userId: string,
  page: number,
  strokes: AnnoStroke[]
): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .upsert(
      { file_id: fileId, user_id: userId, page, strokes: strokes as never },
      { onConflict: 'file_id,user_id,page' }
    )
  if (error) throw new Error(error.message)
}

/** 每册每次会话只报一次推送失败（断网时会一直失败，别刷屏） */
const reportedFileFailure = new Set<string>()

function reportFailure(event: string, fileId: string, page: number, err: unknown, bytes = 0): void {
  const key = `${event}:${fileId}`
  if (reportedFileFailure.has(key)) return
  reportedFileFailure.add(key)
  reportClientError({
    event,
    level: 'warn',
    message: `${event} file ${fileId} page ${page}`,
    // bytes 只在推送失败时有意义：服务端那条 256KB 护栏拒绝时的报错长这样，
    // 但没有体积就分不清是「护栏」「权限」还是「网络」
    detail: { fileId, page, bytes, err: err instanceof Error ? err.message : String(err) },
  })
}

/**
 * 对账一册（先拉后推）。返回的 status 只在真正跑过之后才可能是 'ok'/'failed'——
 * 没登录、同一册正在跑、fileId 为空都是 'skipped'（**不算失败**，不该拦住全局标记的清理）。
 */
export async function syncAnnotationFile(fileId: string): Promise<SyncResult> {
  if (!fileId) return SKIPPED
  if (inFlight.has(fileId)) return SKIPPED
  inFlight.add(fileId)
  try {
    const userId = await currentUserId()
    // 没登录就不动：批注在本地照常用，登录后自然会被推上去
    if (!userId) return SKIPPED

    const local = loadAnnoDoc(fileId)
    // 基线按账号隔离：换账号后当成没有基线（否则新账号拉回空集会被判成「远端删了」而抹掉本地）
    const base = loadSyncBase(fileId, userId)
    const mtime = loadMtime(fileId, userId)
    const remote = await fetchRemotePages(fileId)
    const plan = planSync(local, base, remote, mtime)

    const nextBase = { ...base }
    const nextMtime = { ...mtime }
    for (const item of plan.inSync) nextBase[String(item.page)] = item.fp

    if (plan.toAdopt.length > 0) {
      const doc: AnnoDoc = { ...local }
      const at = new Map(remote.map((r) => [r.page, r.updatedAt]))
      for (const item of plan.toAdopt) {
        doc[String(item.page)] = item.strokes
        nextBase[String(item.page)] = item.fp
        // 落回本地之后，这一页的「本地改动时刻」就是**服务端那一行的时刻**：内容来自它。
        // 不记的话，下次再冲突时本机这一页会拿一个陈旧的时刻去比，判错方向。
        nextMtime[String(item.page)] = at.get(item.page) ?? 0
      }
      saveAnnoDoc(fileId, doc)
      adoptListener?.(fileId, doc)
    }

    let pushed = 0
    let failed = false
    for (const item of plan.toPush) {
      try {
        await pushRemotePage(fileId, userId, item.page, item.strokes)
        nextBase[String(item.page)] = item.fp
        pushed++
      } catch (err) {
        // 失败即留账：这一页的基线**不推进**，下次自然重推
        failed = true
        reportFailure(
          'score_reader_annotation_push_failed',
          fileId,
          item.page,
          err,
          JSON.stringify(item.strokes).length
        )
        break
      }
    }
    // 基线要落盘，包括「推到一半失败」的情况：已经推上去的那些页必须记住，否则每次重推
    saveSyncBase(fileId, userId, nextBase, nextMtime)

    for (const page of plan.conflicts) {
      // message 里带页码 ⇒ 指纹（event + message）逐页不同，同一页的冲突按仓里既有的
      // 5 分钟窗口去重，不会每次同步都刷一条
      const wonBy = plan.lwwRemote.includes(page) ? 'remote' : 'local'
      reportClientError({
        event: 'score_reader_annotation_conflict',
        level: 'warn',
        message: `批注冲突（两边都改过，按 LWW 判给${wonBy === 'local' ? '本地' : '云端'}）file ${fileId} page ${page}`,
        detail: { fileId, page, wonBy },
      })
    }

    return {
      status: failed ? 'failed' : 'ok',
      pushed,
      adopted: plan.toAdopt.length,
      conflicts: plan.conflicts.length,
    }
  } catch (err) {
    reportFailure('score_reader_annotation_pull_failed', fileId, 0, err)
    return { status: 'failed', pushed: 0, adopted: 0, conflicts: 0 }
  } finally {
    inFlight.delete(fileId)
  }
}

let scanning = false
let lastScanAt = 0

/**
 * 把所有有批注的册对一遍账（④⑤ 走这条）。没欠账时**一个请求都不发**。
 *
 * ⚠️ 全局标记**只在全部文件都对账确认后才清**：宁可留下「假真」（多扫一次，便宜），
 * 绝不能「假假」——真欠账被漏掉，那册就永远躺在本地了。
 */
export async function syncAllAnnotationFiles(): Promise<void> {
  if (scanning) return
  if (!isAnnoPending()) return
  const now = Date.now()
  if (now - lastScanAt < SCAN_MIN_INTERVAL_MS) return
  lastScanAt = now
  scanning = true
  try {
    let allOk = true
    for (const fileId of listAnnotatedFileIds()) {
      const result = await syncAnnotationFile(fileId)
      if (result.status === 'failed') allOk = false
    }
    if (allOk) clearAnnoPending()
  } finally {
    scanning = false
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null

/** ① 停笔后防抖：连续画十几笔只在停下时发一次 */
export function scheduleAnnotationSync(fileId: string): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void syncAnnotationFile(fileId)
  }, DEBOUNCE_MS)
}

/**
 * ② 换册 / 离开阅读器：把挂着的那次防抖**立刻**发掉。
 * 拿不到返回值是有意的——页面正在卸载，请求发不发得出去都无所谓，欠账有 ④⑤ 兜。
 */
export function flushAnnotationSync(fileId: string): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  void syncAnnotationFile(fileId)
}

/** ④ 联网恢复。⑤ 由 app.ts 挂在既有的 requestSuccessHook 上（见文件头） */
export function installAnnotationSync(): void {
  try {
    Taro.onNetworkStatusChange?.((res) => {
      if (res.isConnected) void syncAllAnnotationFiles()
    })
  } catch {
    // 挂不上就没有显式信号，还剩 ⑤ 那条被动路径
  }
}
