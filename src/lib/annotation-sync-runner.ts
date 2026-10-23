import Taro from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { reportClientError } from '@/lib/error-report'
import { loadAnnoDoc, saveAnnoDoc, type AnnoDoc, type AnnoStroke } from '@/lib/annotation'
import { fetchArchivePage } from '@/lib/annotation-history'
import { migrateAnnotationStorage } from '@/lib/annotation-migration'
import type { Json } from '@/types/database.types'
import {
  clearAnnoPending,
  contentCovers,
  isAnnoPending,
  listAnnotatedFileIds,
  loadConflicts,
  loadSyncBase,
  mergeStrokes,
  pageFingerprint,
  planSync,
  saveConflicts,
  saveSyncBase,
  type AdoptAction,
  type SyncBase,
  type RemotePage,
} from '@/lib/annotation-sync'

/**
 * 批注上云的**网络那半边**：拉、推（CAS）、以及把两者串起来的对账。
 *
 * 时序（「先拉后推」，三层判定的细节见 annotation-sync.ts 的 planSync）：
 *
 *   1. 拉这册的全部页（**连 version 一起**——它是不透明令牌，也是 CAS 的期望值）
 *   2. 逐页三方比对（本地指纹 / 基线指纹+版本 / 远端指纹+版本）
 *       只有本地变 → 待上传（带 CAS 期望值）      只有远端变 → 落回本地
 *       两边都变   → 先看包含关系；互不包含才记成冲突
 *   3. 逐页推；**逐页确认**——推成功的页才写回基线。CAS 落空要**先比指纹**：
 *      远端内容与我这份一字不差 ⇒ 那是**我自己那次写**（响应丢了 / 丢 ACK），收下版本当成功
 *   4. 冲突写进本地记录并通知界面（进册时、或册内新发现时提示）
 *   5. 全部文件都对账确认后，才清全局欠账标记
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

/**
 * 同一册同时只跑一次（防抖与联网恢复可能撞在一起）。
 *
 * 存的是**在飞的那个 Promise**而不是一个布尔：并发的第二个调用拿到的是同一次运行的
 * 结果，而不是一句「跳过」。对调用方（进册、冲突解决）来说，「这一册现在是对好账的」
 * 才是它要的语义；「跳过」会让它以为已经对过账了。
 */
const inFlight = new Map<string, Promise<SyncResult>>()

/**
 * 正在**解决冲突**的那几册（解决页按下选择按钮时占位）。
 *
 * 它挡的是这一种并发：解决流程在两次网络往返之间（拉版本 → 归档），后台扫描（④⑤ 触发）
 * 对同一册跑了一次对账 —— 那次对账读的是「解决前」的本地内容，算出「这一页还是冲突」，
 * 然后在解决完成之后**整体重写冲突记录**，把刚摘掉的那一页写回去。
 * 表现是：用户解决完返回，列表又弹一次、点进去两版一模一样（已解决的冲突「回魂」）。
 */
const resolving = new Map<string, Promise<unknown>>()

/**
 * 当前打开的阅读器要在「别处（全量扫描）把这册的内容落到本地」时同步刷新内存态，
 * 否则用户会盯着一份过期的画面。阅读器挂载时注册、卸载时注销。
 */
let adoptListener: ((fileId: string, doc: AnnoDoc) => void) | null = null

export function setAnnotationAdoptListener(
  fn: ((fileId: string, doc: AnnoDoc) => void) | null
): void {
  adoptListener = fn
}

/**
 * 「这一册发现了冲突」的通知。阅读器挂载时注册。
 *
 * 每次同步**只要还检出冲突就会通知**（而不是只在「变了」时通知）——因为「本次会话是不是
 * 已经提示过」是**界面的事**：进册要提示一次、用户点了「稍后处理」之后同一批页不再打扰、
 * 出现新页再提示。这些判断需要看到完整的冲突集，这里不替它做。
 */
let conflictListener: ((fileId: string, pages: number[]) => void) | null = null

export function setAnnotationConflictListener(
  fn: ((fileId: string, pages: number[]) => void) | null
): void {
  conflictListener = fn
}

export async function currentUserId(): Promise<string | null> {
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
    .select('page, strokes, version, updated_at')
    .eq('file_id', fileId)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    page: row.page as number,
    strokes: (Array.isArray(row.strokes) ? row.strokes : []) as unknown as AnnoStroke[],
    version: typeof row.version === 'string' ? row.version : null,
    // 服务端盖章的时刻（触发器写的）。**只作诊断**——判定一律看内容，不看时间
    updatedAt: Date.parse(String(row.updated_at ?? '')) || 0,
  }))
}

/** 只取一页（冲突解决页用：它只看这一页，别把整册拉回来） */
async function fetchRemotePage(
  fileId: string,
  page: number
): Promise<{ strokes: AnnoStroke[]; version: string | null }> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('strokes, version')
    .eq('file_id', fileId)
    .eq('page', page)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return {
    strokes: (Array.isArray(data?.strokes) ? data?.strokes : []) as unknown as AnnoStroke[],
    version: typeof data?.version === 'string' ? data.version : null,
  }
}

type PushOutcome = {
  /** true = 服务端接受了这一份内容（或它本来就已经是这一份） */
  ok: boolean
  /** 服务端那一行**现在**的版本；没有行时为 null */
  version: string | null
  /** 冲突时服务端那一行的内容（成功时为 null —— 客户端自己知道刚推的是什么） */
  remote: AnnoStroke[] | null
}

/**
 * 写一页（CAS）。
 *
 * ⚠️ 走 RPC 而不是 postgrest 的 upsert：CAS 要求「读当前行 → 判版本 → 写」是**一条语句**，
 * 先 GET 再 PATCH 会把竞态窗口重新引进来。而且冲突时服务端要**把远端当前内容一并带回**，
 * upsert 拿不到（要么 0 行、要么得再发一次 GET，那次 GET 又可能读到更新的东西）。
 *
 * `expected`：字符串 = 期望的版本；`''` = 期望这一页还不存在；`null` = 无条件覆盖
 * （基线记于本机制之前的老数据 —— 用户 2026-10-14 定：不挡）。
 */
async function pushRemotePage(
  fileId: string,
  page: number,
  strokes: AnnoStroke[],
  expected: string | null
): Promise<PushOutcome> {
  const args: {
    p_file_id: string
    p_page: number
    p_strokes: Json
    p_expected_version?: string
  } = {
    p_file_id: fileId,
    p_page: page,
    p_strokes: strokes,
  }
  // 不传 = 用函数默认值 NULL（无条件覆盖）。传 null 会被类型拒掉，而语义完全一样
  if (expected !== null) args.p_expected_version = expected

  const { data, error } = await supabase.rpc('push_sheet_music_annotation', args)
  if (error) throw new Error(error.message)
  // 生成类型说这两列非空，但 SQL 里冲突时它们可以是 NULL（没有行）——按实际形状读
  const row = (Array.isArray(data) ? data[0] : null) as
    { ok?: unknown; version?: unknown; strokes?: unknown } | null | undefined
  if (!row || typeof row.ok !== 'boolean') throw new Error('bad_rpc_response')
  return {
    ok: row.ok,
    version: typeof row.version === 'string' && row.version ? row.version : null,
    remote: row.ok
      ? null
      : ((Array.isArray(row.strokes) ? row.strokes : []) as unknown as AnnoStroke[]),
  }
}

/** 把「被覆盖的那一份」存进服务端历史（「用远端版」时保住本地那份，见 lib/annotation-sync 的注释） */
async function archiveRemotePage(
  fileId: string,
  page: number,
  strokes: AnnoStroke[]
): Promise<void> {
  const { error } = await supabase.rpc('archive_sheet_music_annotation', {
    p_file_id: fileId,
    p_page: page,
    p_strokes: strokes,
  })
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
 * 没登录、fileId 为空都是 'skipped'（**不算失败**，不该拦住全局标记的清理）。
 */
export async function syncAnnotationFile(fileId: string): Promise<SyncResult> {
  if (!fileId) return SKIPPED
  const running = inFlight.get(fileId)
  if (running) return running
  const solving = resolving.get(fileId)
  if (solving) {
    // 正在解决冲突：**等它落地再对账**（那之后算出来的计划才是准的）。不并发跑，
    // 也不当成「跳过」——「跳过」会让全量扫描以为这一册已经对过账而清掉欠账标记
    await solving.catch(() => {})
    const again = inFlight.get(fileId)
    if (again) return again
  }
  const run = runSync(fileId).finally(() => {
    if (inFlight.get(fileId) === run) inFlight.delete(fileId)
  })
  inFlight.set(fileId, run)
  return run
}

/**
 * 把「收下远端」的页写回本地。返回**真正收下了几页**。
 *
 * 两条都必须守住（它们挡的是同一类真机表现：画着画着笔迹没了）：
 *
 * 1. **现读一次 Storage**，不拿同步开始时的快照整份写回 —— 拉取与推送是两次网络往返，
 *    这期间用户可能已经又画了别的页（`persist` 落盘了，也在阅读器的 `annosRef` 里）。
 *    只替换要收下的那几页，别的页原样保留。
 * 2. **逐页复核判定没过期**（`localFp`）—— 要收下的那一页若在这期间被改过，这一次
 *    **不收它**：计划是「远端改过、本地没动」时下的，前提没了就不能执行。
 *    那一页留到下一次对账（用户的改动触发了防抖，很快就会跑）按当时的真实三方重算。
 */
function applyAdopt(
  owner: string,
  fileId: string,
  items: AdoptAction[],
  nextBase: SyncBase
): number {
  if (items.length === 0) return 0
  const doc: AnnoDoc = { ...loadAnnoDoc(owner, fileId) }
  let applied = 0
  for (const item of items) {
    const key = String(item.page)
    if (pageFingerprint(doc[key] ?? []) !== item.localFp) continue
    doc[key] = item.strokes
    nextBase[key] = { fp: item.fp, version: item.version ?? undefined }
    applied++
  }
  if (applied === 0) return 0
  saveAnnoDoc(owner, fileId, doc)
  adoptListener?.(fileId, doc)
  return applied
}

async function runSync(fileId: string): Promise<SyncResult> {
  try {
    const userId = await currentUserId()
    // 没登录就不动：批注在本地照常用，登录后自然会被推上去
    if (!userId) return SKIPPED

    const local = loadAnnoDoc(userId, fileId)
    // 基线按账号隔离：换账号后当成没有基线（否则新账号拉回空集会被判成「远端删了」而抹掉本地）
    const base = loadSyncBase(fileId, userId)
    const remote = await fetchRemotePages(fileId)
    const plan = planSync(local, base, remote)

    const nextBase: SyncBase = { ...base }
    for (const item of plan.inSync) {
      nextBase[String(item.page)] = { fp: item.fp, version: item.version ?? undefined }
    }

    const adopted = [...plan.toAdopt]
    let pushed = 0
    let failed = false
    /** 推的那一刻才发现的分叉（CAS 落空且内容互不包含）——与拉取时判出的冲突合并上报 */
    const lateConflicts: number[] = []
    for (const item of plan.toPush) {
      try {
        const outcome = await pushRemotePage(fileId, item.page, item.strokes, item.expected)
        if (outcome.ok) {
          nextBase[String(item.page)] = { fp: item.fp, version: outcome.version ?? undefined }
          pushed++
          continue
        }
        // —— CAS 落空。三种可能，按可能性从高到低判 ——
        const remoteStrokes = outcome.remote ?? []
        if (pageFingerprint(remoteStrokes) === item.fp) {
          // ① 远端内容与我这份**一字不差** ⇒ 这就是我自己那次写（响应丢了 / 丢 ACK）。
          //    收下版本当成功——**绝不能报冲突**，否则用户会对着自己刚写的两份做选择。
          nextBase[String(item.page)] = { fp: item.fp, version: outcome.version ?? undefined }
          pushed++
          continue
        }
        if (contentCovers(remoteStrokes, item.strokes)) {
          // ② 远端 ⊆ 本地 ⇒ 别人在我画的基础上接着画了一点，而那份全在我这儿。
          //    用**刚拿到的版本**再 CAS 一次即可（只重试一次：再失败就说明还在动）
          const retry = await pushRemotePage(fileId, item.page, item.strokes, outcome.version ?? '')
          if (retry.ok || pageFingerprint(retry.remote ?? []) === item.fp) {
            nextBase[String(item.page)] = { fp: item.fp, version: retry.version ?? undefined }
            pushed++
            continue
          }
          lateConflicts.push(item.page)
          continue
        }
        if (contentCovers(item.strokes, remoteStrokes)) {
          // ③ 本地 ⊆ 远端 ⇒ 别人已经把这一页画成了我的超集（我这几笔都在里面）⇒ 收下，
          //    与拉取阶段同款。**这一半不能漏**：漏了就会把本该静默合掉的一页弹给用户
          adopted.push({
            page: item.page,
            strokes: remoteStrokes,
            fp: pageFingerprint(remoteStrokes),
            version: outcome.version,
            localFp: item.fp,
          })
          continue
        }
        // ④ 真分叉：两边都有对方没有的东西，交给用户选（这一页继续不动，等解决）
        lateConflicts.push(item.page)
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
    /** 收下远端的页**在推完之后**统一落盘：那时才读得到用户在这期间新画的笔迹（见 applyAdopt） */
    const adoptedCount = applyAdopt(userId, fileId, adopted, nextBase)
    // 基线要落盘，包括「推到一半失败」的情况：已经推上去的那些页必须记住，否则每次重推
    saveSyncBase(fileId, userId, nextBase)

    // 冲突记录：**每次对完账都整体重写**（没有冲突就删掉记录）。它是三方差分的产物，
    // 不是一份独立的账 —— 谁在别处解决了，下一次同步自然就把它摘掉了
    const conflicts = [...new Set([...plan.conflicts, ...lateConflicts])].sort((a, b) => a - b)
    saveConflicts(fileId, userId, conflicts)
    if (conflicts.length > 0) {
      reportClientError({
        event: 'score_reader_annotation_conflict',
        level: 'warn',
        message: `批注冲突（两边都改过同一页）file ${fileId} pages ${conflicts.join(',')}`,
        detail: { fileId, pages: conflicts, autoMerged: plan.autoMerged },
      })
      conflictListener?.(fileId, conflicts)
    }

    return {
      status: failed ? 'failed' : 'ok',
      pushed,
      adopted: adoptedCount,
      conflicts: conflicts.length,
    }
  } catch (err) {
    // 拉取失败：**不碰冲突记录**——这一次什么都没对成，旧记录仍然是对账的结果
    reportFailure('score_reader_annotation_pull_failed', fileId, 0, err)
    return { status: 'failed', pushed: 0, adopted: 0, conflicts: 0 }
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
  const userId = await currentUserId()
  // 上面的 await 让出了执行权：并发调用可能都通过了第一道检查，这里再判一次
  if (scanning) return
  if (!userId) return
  // D16 兜底：会话可能比 user-context 的迁移先就绪；旧键先归到当前账号名下再列册
  migrateAnnotationStorage(userId)
  if (!isAnnoPending(userId)) return
  const now = Date.now()
  if (now - lastScanAt < SCAN_MIN_INTERVAL_MS) return
  lastScanAt = now
  scanning = true
  try {
    let allOk = true
    for (const fileId of listAnnotatedFileIds(userId)) {
      const result = await syncAnnotationFile(fileId)
      // 只有 ok 才算确认过：skipped 意味着中途没了会话，不能据此清欠账
      if (result.status !== 'ok') allOk = false
    }
    if (allOk) clearAnnoPending(userId)
  } finally {
    scanning = false
  }
}

/**
 * 登出前的最后一班车（D16 / C1）：把这个账号所有有批注的册对一次账。
 *
 * 返回 true = 每一册都确认过（失败的那一册不会推进基线，下次登录会重推）。
 * 调用方据此决定能不能删本地键。**必须在 `signOut()` 之前调用**：令牌一旦撤销，
 * RLS 会把所有请求挡掉，那时再 flush 只会得到一连串失败。
 */
export async function flushAllAnnotationsForOwner(owner: string): Promise<boolean> {
  const userId = await currentUserId()
  if (userId !== owner) return false
  migrateAnnotationStorage(owner)
  let allOk = true
  for (const fileId of listAnnotatedFileIds(owner)) {
    const result = await syncAnnotationFile(fileId)
    if (result.status !== 'ok') allOk = false
  }
  if (allOk) clearAnnoPending(owner)
  return allOk
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

/**
 * 读这一册当前未解决的冲突页（阅读器用它决定要不要弹列表）。
 *
 * 走这条而不是直接 loadConflicts：记录是**按账号**隔离的，而账号要从会话里取。
 * 认不出账号就返回空——提示一个当前账号根本动不了的冲突没有意义。
 */
export async function loadConflictPages(fileId: string): Promise<number[]> {
  const userId = await currentUserId()
  if (!userId) return []
  return loadConflicts(fileId, userId)
}

/** 冲突解决页要用的一页快照（本地一份、对照一份） */
export type ConflictPageState = {
  local: AnnoStroke[]
  /** 对照的那一份：默认是**实时远端**；从「恢复云端历史」进来时是那一版**历史内容** */
  remote: AnnoStroke[]
  /** 远端那一行**此刻**的版本；**CAS 与提交都认它** —— 它一变就说明远端又动过。
   *  ⚠️ 它**永远**是实时远端的版本，不是 `remote` 那一份的版本（历史对照时两者不同） */
  remoteVersion: string | null
  /** 本次对照的是历史版本（`remote` 装的就是它）—— `resolve` 据此把「采纳」变成「推上去」 */
  comparedArchiveVersion?: string
}

/**
 * 读这一页的两份内容（冲突解决页的入口）。
 *
 * @param archiveVersion 「恢复云端历史」入口带来的历史版本号：把**那一版**当对照侧。
 *   CAS 基准仍是实时远端（见 `remoteVersion` 的注释）—— 这正是「不改冲突页也能复用」的关键。
 */
export async function loadConflictPage(
  fileId: string,
  page: number,
  archiveVersion?: string | null
): Promise<ConflictPageState> {
  const userId = await currentUserId()
  const local = userId ? (loadAnnoDoc(userId, fileId)[String(page)] ?? []) : []
  const remote = await fetchRemotePage(fileId, page)
  if (archiveVersion) {
    const archived = await fetchArchivePage(fileId, page, archiveVersion)
    // 取不到那一版就退回实时远端：宁可让用户看到一次普通的冲突，也不要拿空内容去对照
    if (archived) {
      return {
        local,
        remote: archived,
        remoteVersion: remote.version,
        comparedArchiveVersion: archiveVersion,
      }
    }
  }
  return { local, remote: remote.strokes, remoteVersion: remote.version }
}

export type ResolveResult = {
  ok: boolean
  /** ok=false 时为什么：没登录 / 远端又变了（要重新预览）/ 网络或服务端失败 */
  reason?: 'no-user' | 'raced' | 'failed'
}

/**
 * 解决一页冲突：用户选了留哪一版。
 *
 * - `'local'`  —— 用本地这份覆盖远端：以**预览时看到的那个远端版本**做 CAS。
 * - `'remote'` —— 采纳远端：**先把本地这份送进服务端历史**再覆盖本地。
 *   少了这一步，「用远端版」就是一次不可逆的丢弃；而服务端自始至终没见过本地那份，
 *   它自己归档不了。
 * - `'merge'`  —— 两版取**并集**（用户 2026-10-15 定）：合并结果既推上远端也落本地。
 *   被顶掉的远端那份由推送 RPC 自动归档，本地那份的内容本来就在并集里 ⇒ 两边都不丢。
 *   ⚠️ 这个模型里没有 per-stroke id / 墓碑 ⇒ **分不清「一边画了 X、另一边把 X 擦了」**，
 *   并集会把擦掉的那笔带回来。用户是看着合并预览点的，知情即可（方案 §5 论证过的是
 *   「自动合并不可行」，这里做的是手动并集，语义不同）。
 *
 * ⚠️ 三种选择都以 `shownVersion`（预览时那一版的版本号）为前提：远端若在用户看预览的
 * 时候又变了，就**什么都不做**并回 `raced` —— 让用户重新看一遍再选。按新内容套用旧选择，
 * 等于让用户为一个他没见过的版本做决定。
 */
export async function resolveAnnotationConflict(args: {
  fileId: string
  page: number
  choice: 'local' | 'remote' | 'merge'
  shownVersion: string | null
  /** 与 `loadConflictPage` 的第三参同源：「对照侧是历史版本」时，「采纳」= 把那一版
   *  **推上云端**（只落本地的话，本地与云端不一致 ⇒ 下一次同步立刻又记成一次冲突） */
  archiveVersion?: string | null
}): Promise<ResolveResult> {
  const { fileId, page, choice, shownVersion, archiveVersion } = args
  const userId = await currentUserId()
  if (!userId) return { ok: false, reason: 'no-user' }

  // 占住这一册：见 `resolving` 的注释（不然并发的后台扫描会把刚摘掉的冲突写回记录）
  const prev = resolving.get(fileId)
  if (prev) await prev.catch(() => {})
  let release: () => void = () => {}
  const mine = new Promise<void>((resolve) => {
    release = resolve
  })
  resolving.set(fileId, mine)

  try {
    const running = inFlight.get(fileId)
    if (running) await running.catch(() => {})

    const fresh = await fetchRemotePage(fileId, page)
    if ((fresh.version ?? null) !== (shownVersion ?? null)) return { ok: false, reason: 'raced' }

    // 对照的那一份：默认是**实时远端**；从「恢复云端历史」进来时是那一版历史内容。
    // ⚠️ 它与 CAS 基准是**两件事**：上面那句比的始终是实时远端的版本。
    let compareStrokes = fresh.strokes
    if (archiveVersion) {
      const archived = await fetchArchivePage(fileId, page, archiveVersion)
      if (!archived) return { ok: false, reason: 'failed' }
      compareStrokes = archived
    }

    const localStrokes = loadAnnoDoc(userId, fileId)[String(page)] ?? []
    const localFp = pageFingerprint(localStrokes)

    if (choice === 'local') {
      const outcome = await pushRemotePage(fileId, page, localStrokes, fresh.version ?? '')
      const same = outcome.ok || pageFingerprint(outcome.remote ?? []) === localFp
      if (!same) return { ok: false, reason: 'raced' }
      const base = loadSyncBase(fileId, userId)
      base[String(page)] = { fp: localFp, version: outcome.version ?? undefined }
      saveSyncBase(fileId, userId, base)
    } else if (choice === 'merge') {
      // 并集 = 本地在前、远端在后（绘制顺序 = 数组顺序，远端那份「在上层」）。
      // **同一笔只留一条**（`mergeStrokes`）：两端都有的那一笔叠起来会深一层，荧光笔最明显。
      // ⚠️ 它只去掉「完全同一笔」，**擦除语义仍然无法表达** —— 这个模型没有墓碑，
      // 「一边画了 X、另一边把 X 擦了」分不清，并集会把擦掉的那笔带回来（合并前有预览）。
      const merged = mergeStrokes(localStrokes, compareStrokes)
      const mergedFp = pageFingerprint(merged)
      const outcome = await pushRemotePage(fileId, page, merged, fresh.version ?? '')
      // 与 'local' 分支同款：CAS 落空但服务端已经是这一份（重复提交 / 丢 ACK）也算成功
      const same = outcome.ok || pageFingerprint(outcome.remote ?? []) === mergedFp
      if (!same) return { ok: false, reason: 'raced' }
      const doc: AnnoDoc = { ...loadAnnoDoc(userId, fileId) }
      doc[String(page)] = merged
      // ⚠️ 与 'remote' 分支同一条纪律：写盘失败就**不推进基线**，否则下次同步会拿旧本地
      // 把刚合并上去的内容顶回去
      if (!saveAnnoDoc(userId, fileId, doc)) {
        reportFailure('score_reader_annotation_save_failed', fileId, page, new Error('save_failed'))
        return { ok: false, reason: 'failed' }
      }
      adoptListener?.(fileId, doc)
      const base = loadSyncBase(fileId, userId)
      base[String(page)] = { fp: mergedFp, version: outcome.version ?? undefined }
      saveSyncBase(fileId, userId, base)
    } else {
      const remoteFp = pageFingerprint(fresh.strokes)
      // 本地那份万一与远端一字不差（用户在别处已经收下过），没有要保的东西，跳过归档
      if (localFp !== remoteFp && localStrokes.some((s) => (s.points?.length ?? 0) > 0)) {
        try {
          await archiveRemotePage(fileId, page, localStrokes)
        } catch (err) {
          // 归档失败就**不采纳**：宁可让用户待会儿再试，也不能把本地那份弄丢
          reportFailure('score_reader_annotation_archive_failed', fileId, page, err)
          return { ok: false, reason: 'failed' }
        }
      }
      const doc: AnnoDoc = { ...loadAnnoDoc(userId, fileId) }
      doc[String(page)] = fresh.strokes
      // ⚠️ 写盘失败就**不推进基线**：否则磁盘上还是旧本地那份，而基线已经说「和远端一致了」
      // ⇒ 下一次同步会拿旧本地当「本地改过」推上去，把刚采纳的云端版顶回去
      if (!saveAnnoDoc(userId, fileId, doc)) {
        reportFailure('score_reader_annotation_save_failed', fileId, page, new Error('save_failed'))
        return { ok: false, reason: 'failed' }
      }
      adoptListener?.(fileId, doc)
      const base = loadSyncBase(fileId, userId)
      base[String(page)] = { fp: remoteFp, version: fresh.version ?? undefined }
      saveSyncBase(fileId, userId, base)
    }

    // 解决完立刻把它从冲突记录里摘掉，不必等下一次同步
    saveConflicts(
      fileId,
      userId,
      loadConflicts(fileId, userId).filter((p) => p !== page)
    )
    return { ok: true }
  } catch (err) {
    reportFailure('score_reader_annotation_resolve_failed', fileId, page, err)
    return { ok: false, reason: 'failed' }
  } finally {
    release()
    if (resolving.get(fileId) === mine) resolving.delete(fileId)
  }
}

/** 测试用：把「同一册只跑一次」的记账清干净（生产路径不需要） */
export function __resetAnnotationSyncState(): void {
  inFlight.clear()
  resolving.clear()
  reportedFileFailure.clear()
}
