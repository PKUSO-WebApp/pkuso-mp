import Taro from '@tarojs/taro'
import { annoStoragePrefix, compactStroke, type AnnoDoc, type AnnoStroke } from './annotation'

/**
 * 批注上云的**纯逻辑**：内容指纹、三方差分、以及三种记账（基线 / 欠账标记 / 冲突记录）的读写。
 *
 * 这一层不 import supabase（那会在缺 env 时**导入即抛**，测试连模块都加载不了）——
 * 网络那半边在 annotation-sync-runner.ts。两者的分界是「能不能只靠本地状态算出来」。
 *
 * ## 判定用「内容指纹」，写入用「版本号」——两把不同的尺子
 *
 * - **指纹**（`pageFingerprint`，客户端算）：回答「这一页的内容是不是我上次同步的那一份」。
 *   它不依赖任何内存态，所以**进程被强杀也不丢**——欠账是可推导的，不是被记住的。
 * - **版本号**（`version`，**服务端**算的 md5）：推送时的 CAS 令牌。客户端**只存不造**，
 *   原样把上次拉到的那个字符串带回去即可 ⇒「客户端报一个假的版本号」这条口子不存在，
 *   也不必在客户端复刻 jsonb 的规范化文本。
 *
 * ## 冲突：不再替用户选，也不再静默丢
 *
 * 从前两边都改过时按 LWW 用**设备时钟**判先后——时钟不可信，而且输的那一份是**静默丢掉**的。
 * 现在：先看包含关系（一份完整包含另一份 ⇒ 取超集那一边，两边都没丢，不打扰用户），
 * 互不包含的**真分叉**才记下来、交给用户选。选择之前两边都不动。
 */

/** 上次同步成功时，每页的内容指纹 + 服务端那一页的版本号 */
export type BaseEntry = {
  fp: string
  /**
   * 服务端那一行的 `version`。**客户端只存不造**，而且服务端也可能返回空。
   * 缺 = 这条基线记于此机制之前（老版本写的）⇒ 推送时按无条件写处理。
   */
  version?: string
}
export type SyncBase = Record<string, BaseEntry>

/** 服务端一行的形态（查询回来的原始行） */
export type RemotePage = {
  page: number
  strokes: AnnoStroke[]
  /** 服务端那一行的 `version`（CAS 令牌）；没有（异常形态）当缺 */
  version: string | null
  /** 服务端那一行的 `updated_at`（epoch ms）。**只作诊断**，不参与任何判定 */
  updatedAt: number
}

/** 与批注正文同一套账号隔离（D16）：owner = auth user id，未登录为 `guest` */
export const annoSyncPrefix = (owner: string) => `score-annotation-sync-v2:${owner}:`
export const annoSyncKey = (owner: string, fileId: string) => `${annoSyncPrefix(owner)}${fileId}`

/**
 * 冲突记录：这一册有哪些页处在「两边都改过、还没解决」的状态。
 *
 * 为什么要落盘（而不是只在内存里）：冲突是**在别处发现的**——用户画完退出、后台同步才发现，
 * 那一刻没有界面可以问。记录留着，下次进这一册（或下一次同步）才提示得到。
 * 它也是**可推导的**：每次同步都会按当前的三方差分重算一遍，所以记录永远会被刷新，
 * 不存在「用户已经在别处解决了、这里还挂着」的死记录。
 */
export const annoConflictPrefix = (owner: string) => `score-annotation-conflict-v2:${owner}:`
export const annoConflictKey = (owner: string, fileId: string) =>
  `${annoConflictPrefix(owner)}${fileId}`

/** 「可能有欠账」标记：真时下次联网要把**这个账号下所有**有批注的册对一遍账 */
export const ANNO_PENDING_KEY = (owner: string) => `score-annotation-pending-v2:${owner}`

/** 列册用的前缀（按账号隔离） */
const annoDocPrefix = annoStoragePrefix

// ---- D16 之前的旧键：只给 annotation-migration 用 ----
export const LEGACY_ANNO_PENDING_KEY = 'score-annotation-pending'

const FNV_OFFSET = 2166136261
const FNV_PRIME = 16777619

/**
 * 一页笔迹的内容指纹：**顺序敏感**（笔迹的先后影响观感，交换两笔不能算「没变」），
 * 两条种子不同的 32 位累加器拼起来，碰撞要两条同时撞上才发生。
 *
 * ⚠️ 必须先过 `compactStroke`：内存里的笔迹是**未压缩**的原始触点（`persist` 只把压缩结果
 * 写进 Storage），不先归一化的话，同一份内容在内存与存储里会算出两个指纹——那会被判成
 * 「本地改过」，每次进册都白推一次。`compactStroke` 幂等，所以重复过无害。
 */
export function pageFingerprint(strokes: AnnoStroke[]): string {
  const list = Array.isArray(strokes) ? strokes : []
  let a = FNV_OFFSET
  let b = 0x9e3779b9
  const push = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i)
      a = Math.imul(a ^ c, FNV_PRIME) >>> 0
      b = Math.imul(b ^ c, FNV_PRIME) >>> 0
    }
  }
  for (const stroke of list) {
    const c = compactStroke(stroke)
    // 零点的笔迹不渲染、也不该参与判定：让它与「没有这一笔」等价
    if (c.points.length === 0) continue
    // alpha 也在内：只在颜色/线宽/点上相同的荧光笔与画笔不是同一份内容
    push(`${c.color}|${c.width}|${c.alpha ?? 1}|`)
    for (const p of c.points) push(`${p[0]},${p[1]};`)
    push('\n')
  }
  return `${a.toString(36)}-${b.toString(36)}`
}

/** 空页的指纹（`[]` 的指纹是个常量，比较时直接用） */
export const EMPTY_FP = pageFingerprint([])

/**
 * 单笔的规范键：与指纹同一套归一化（先 compact、零点笔迹当不存在）。
 *
 * 用途只有一个——判**包含关系**（见 contentCovers）。它比指纹细一档：指纹回答「整页一不一样」，
 * 它回答「这一笔在不在那边」。两者必须同源，否则会出现「整页相同、笔迹却互不包含」这种自相矛盾。
 */
export function strokeKey(stroke: AnnoStroke): string | null {
  const c = compactStroke(stroke)
  if (c.points.length === 0) return null
  return `${c.color}|${c.width}|${c.alpha ?? 1}|${c.points.map((p) => `${p[0]},${p[1]}`).join(';')}`
}

/**
 * 两版笔迹**取并集**（冲突解决页「合并两版」用的那一步）：本地在前、远端在后。
 *
 * **同一笔只留一条**，判据就是 `strokeKey`（颜色 / 线宽 / alpha / 点序列全同）。两端都有的
 * 那一笔叠加起来会**深一层** —— 荧光笔最明显（同一道高亮在两版里各一份），用户 2026-10-15
 * 真机报的就是这个。只是「画得像」不算同一笔：这一层没有可靠判据，宁可都留着（这个模型里
 * 没有 per-stroke id，位置相近的两笔本来就分不开）。
 *
 * 复用 `strokeKey` 还白拿一件事：判重与指纹 / 包含关系**同一套归一化**（先 compact、零点
 * 笔迹当不存在），不会出现「包含关系说这两版一样、合并却留下两笔」这种自相矛盾。
 */
export function mergeStrokes(local: AnnoStroke[], remote: AnnoStroke[]): AnnoStroke[] {
  const seen = new Set<string>()
  const out: AnnoStroke[] = []
  const all = [...(Array.isArray(local) ? local : []), ...(Array.isArray(remote) ? remote : [])]
  for (const s of all) {
    const key = strokeKey(s)
    if (key === null || seen.has(key)) continue // null = 零点笔迹：不渲染，也不该占位
    seen.add(key)
    out.push(s)
  }
  return out
}

/** 笔迹的**多重集**计数（同一笔重复画两次是两笔，不是一笔） */
function strokeCounts(strokes: AnnoStroke[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of Array.isArray(strokes) ? strokes : []) {
    const key = strokeKey(s)
    if (key === null) continue
    out.set(key, (out.get(key) ?? 0) + 1)
  }
  return out
}

/**
 * `sub` 的每一笔都在 `sup` 里（**按份数**）。
 *
 * 用多重集而不是集合：同一个位置画两笔与画一笔是两份内容，按集合比会把「少画了一笔」
 * 也算成包含，那就等于静默丢一笔。
 */
export function contentCovers(sub: AnnoStroke[], sup: AnnoStroke[]): boolean {
  const a = strokeCounts(sub)
  if (a.size === 0) return true
  const b = strokeCounts(sup)
  for (const [key, n] of a) {
    if ((b.get(key) ?? 0) < n) return false
  }
  return true
}

export type PushAction = {
  page: number
  strokes: AnnoStroke[]
  fp: string
  /**
   * CAS 的期望值：
   * - 字符串 = 期望服务端那一页的版本恰好是它；
   * - `''` = 期望那一页**还不存在**（首次写）；
   * - `null` = 无条件覆盖（这条基线记于本机制之前，没有版本可比 —— 用户 2026-10-14 定：不挡）。
   */
  expected: string | null
}

export type AdoptAction = {
  page: number
  strokes: AnnoStroke[]
  fp: string
  version: string | null
  /**
   * **做这次判定时**本地那一页的指纹。落盘前要拿它复核一遍：拉取是网络往返，
   * 这期间用户可能正好在改这一页 —— 那份判定就过期了，不能再拿它覆盖本地
   *（否则用户在拉取窗口里画的笔迹会被「收下的远端内容」顶掉）。
   */
  localFp: string
}

export type SyncPlan = {
  /** 本地改过、远端没动 ⇒ 上传（带 CAS 期望值） */
  toPush: PushAction[]
  /** 远端改过、本地没动（或包含关系判给远端）⇒ 落回本地 */
  toAdopt: AdoptAction[]
  /** 已经一致（含「碰巧改成同一份」）⇒ 把基线推到当前指纹与版本即可 */
  inSync: Array<{ page: number; fp: string; version: string | null }>
  /** 真分叉（互不包含）：两边都不动，只记下来交给用户选 */
  conflicts: number[]
  /** 被**包含关系**自动裁决掉的页（不打扰用户）——诊断用，不进任何上报 */
  autoMerged: Array<{ page: number; took: 'local' | 'remote' }>
}

/** 页码的键可能是别人写坏的值；只接受 >=1 的整数，其余当不存在 */
function toPage(key: string): number | null {
  const n = Number(key)
  return Number.isInteger(n) && n >= 1 ? n : null
}

/**
 * 三方差分：本地 / 基线（上次同步成功时）/ 远端 → 该做什么。
 *
 * 「基线」是判定的支点：某一边与基线相同 ⇒ 那一边**没动**，另一边的变化就是要传播的。
 * 两边都与基线不同 ⇒ 两边都动过 ⇒ 先按包含关系自动裁决，互不包含才是真分叉。
 *
 * 基线**缺失**（这一页从没同步过：功能上线前画的、或离线画的）时不能猜谁新谁旧——同样交给
 * 包含关系判，判不了就是冲突。
 */
export function planSync(local: AnnoDoc, base: SyncBase, remote: RemotePage[]): SyncPlan {
  const remoteMap = new Map<number, AnnoStroke[]>()
  const remoteVer = new Map<number, string | null>()
  for (const row of remote) {
    if (!Number.isInteger(row.page) || row.page < 1) continue
    remoteMap.set(row.page, Array.isArray(row.strokes) ? row.strokes : [])
    remoteVer.set(row.page, typeof row.version === 'string' && row.version ? row.version : null)
  }

  const pages = new Set<number>()
  for (const key of Object.keys(local)) {
    const p = toPage(key)
    if (p !== null) pages.add(p)
  }
  for (const key of Object.keys(base)) {
    const p = toPage(key)
    if (p !== null) pages.add(p)
  }
  for (const p of remoteMap.keys()) pages.add(p)

  const plan: SyncPlan = { toPush: [], toAdopt: [], inSync: [], conflicts: [], autoMerged: [] }

  /**
   * 两边都动过时唯一的自动裁决：**谁包含谁**。
   *
   * 它挡掉的正是最常见的一类「冲突」：一台设备接着另一台画（本地就是「远端 ∪ 我这几笔」）。
   * 取超集那一边两边都不丢——子集那一份的每一笔都在超集里，所以这**不是**静默丢数据，
   * 与 LWW 有本质区别。互不包含（各画了对方没有的笔）才记成冲突。
   *
   * ⚠️ **「一边空了」不算包含**（`baseFp` 那条早退）：空集被一切内容包含，于是
   * 「我把这一页擦空、别人在这一页上又画了」会被判成「本地 ⊆ 远端 ⇒ 收下」——
   * 那等于**替用户撤销了他的擦除**。笔迹记不住「少了一笔」，只有在基线的对照下
   * 「变空」才是可辨认的编辑 ⇒ 基线说这一页原本有内容时，这一支交给用户选
   *（方案 §4：一边画了 X、另一边把 X 擦了，集合层面分不出来，只能问）。
   */
  const byInclusion = (
    page: number,
    localStrokes: AnnoStroke[],
    remoteStrokes: AnnoStroke[],
    l: string,
    r: string,
    rv: string | null,
    baseFp: string | undefined
  ) => {
    if (baseFp !== undefined && baseFp !== EMPTY_FP && (l === EMPTY_FP || r === EMPTY_FP)) {
      plan.conflicts.push(page)
      return
    }
    if (contentCovers(remoteStrokes, localStrokes)) {
      // 远端 ⊆ 本地 ⇒ 推本地（超集）。expected 用**刚读到的**远端版本 ⇒ 正常情况下一次就成
      plan.toPush.push({ page, strokes: localStrokes, fp: l, expected: rv ?? '' })
      plan.autoMerged.push({ page, took: 'local' })
      return
    }
    if (contentCovers(localStrokes, remoteStrokes)) {
      // 本地 ⊆ 远端 ⇒ 直接收下远端（本地那几笔远端都有）
      plan.toAdopt.push({ page, strokes: remoteStrokes, fp: r, version: rv, localFp: l })
      plan.autoMerged.push({ page, took: 'remote' })
      return
    }
    plan.conflicts.push(page)
  }

  for (const page of [...pages].sort((x, y) => x - y)) {
    const key = String(page)
    const localStrokes = local[key] ?? []
    const remoteStrokes = remoteMap.get(page) ?? []
    const l = pageFingerprint(localStrokes)
    const r = pageFingerprint(remoteStrokes)
    const rv = remoteVer.get(page) ?? null
    const b = base[key]

    if (l === r) {
      plan.inSync.push({ page, fp: l, version: rv })
      continue
    }
    if (b === undefined) {
      // 没有基线 ⇒ 没有「谁动过」可依据，只能看包含关系。这里**不**套用「一边空了 ⇒ 冲突」
      // 那条：没有基线就无从知道这一页原本有没有内容 —— 一边有一边空时方向是明确的
      //（没基线的那本册第一次同步就落在这里，猜成冲突会让所有旧数据都弹一次窗）
      byInclusion(page, localStrokes, remoteStrokes, l, r, rv, undefined)
      continue
    }
    if (r === b.fp) {
      // 远端 == 基线 ⇒ 远端没动、本地改了 ⇒ 推。expected 取基线里记的版本
      plan.toPush.push({ page, strokes: localStrokes, fp: l, expected: b.version ?? null })
      continue
    }
    if (l === b.fp) {
      // 本地 == 基线 ⇒ 本地没动、远端改了 ⇒ 收下
      plan.toAdopt.push({ page, strokes: remoteStrokes, fp: r, version: rv, localFp: l })
      continue
    }
    // 两边都动过
    byInclusion(page, localStrokes, remoteStrokes, l, r, rv, b.fp)
  }
  return plan
}

/**
 * 基线**按账号隔离**：记录里带着它是为谁记的，换账号后一律当没有。
 *
 * 不隔离会静默毁数据：换账号（同一台设备登了别人）后，旧基线仍说「远端有这些页」，
 * 而新账号拉回来的是空的 ⇒ 判定成「远端把这一页删了」⇒ **把本地批注整册抹掉**。
 * 当成没有基线之后，同一份本地内容会被判成「本地有、远端空」⇒ 推给当前账号，
 * 两边都不丢。
 */
export type SyncRecord = {
  userId: string
  base: SyncBase
}

/** 旧版基线是「页码 → 指纹」的纯字符串表；读进来一律补成 BaseEntry（version 缺 = 老数据） */
function normalizeBase(raw: unknown): SyncBase | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: SyncBase = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = { fp: v }
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const e = v as { fp?: unknown; version?: unknown }
      if (typeof e.fp !== 'string') continue
      out[k] =
        typeof e.version === 'string' && e.version ? { fp: e.fp, version: e.version } : { fp: e.fp }
    }
  }
  return out
}

export function loadSyncBase(fileId: string, userId: string): SyncBase {
  try {
    const raw = Taro.getStorageSync(annoSyncKey(userId, fileId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const record = parsed as Partial<SyncRecord>
    if (record.userId !== userId) return {}
    return normalizeBase(record.base) ?? {}
  } catch {
    return {}
  }
}

/** 写基线失败（存储满）只会让下次多推一遍，不影响正确性，故只回布尔不抛 */
export function saveSyncBase(fileId: string, userId: string, base: SyncBase): boolean {
  try {
    const record: SyncRecord = { userId, base }
    Taro.setStorageSync(annoSyncKey(userId, fileId), JSON.stringify(record))
    return true
  } catch {
    return false
  }
}

/** 读这一册未解决的冲突页（**按账号隔离**，理由同基线）。坏数据一律当没有 */
export function loadConflicts(fileId: string, userId: string): number[] {
  try {
    const raw = Taro.getStorageSync(annoConflictKey(userId, fileId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    const record = parsed as { userId?: unknown; pages?: unknown }
    if (record.userId !== userId || !Array.isArray(record.pages)) return []
    return record.pages
      .map((p) => Number(p))
      .filter((p) => Number.isInteger(p) && p >= 1)
      .sort((x, y) => x - y)
  } catch {
    return []
  }
}

/**
 * 覆盖写这一册的冲突页。**空数组 = 删掉这条记录**（没有冲突就该没有记录，
 * 不然「有没有冲突」会变成一份会腐烂的副本）。
 */
export function saveConflicts(fileId: string, userId: string, pages: number[]): void {
  try {
    const unique = [...new Set(pages.filter((p) => Number.isInteger(p) && p >= 1))].sort(
      (x, y) => x - y
    )
    if (unique.length === 0) Taro.removeStorageSync(annoConflictKey(userId, fileId))
    else
      Taro.setStorageSync(
        annoConflictKey(userId, fileId),
        JSON.stringify({ userId, pages: unique })
      )
  } catch {
    // 记不下只是下次少提示一次；冲突本身还在（判定完全由内容推导），不会因此丢东西
  }
}

/** 从冲突记录里摘掉一页（解决完一页就调它——不必等下一次同步） */
export function clearConflictPage(fileId: string, userId: string, page: number): void {
  const rest = loadConflicts(fileId, userId).filter((p) => p !== page)
  saveConflicts(fileId, userId, rest)
}

/**
 * 记「可能有欠账」。**本地每次改动都要调**——它是「离线改了 3 册然后被强杀」能被补上的
 * 唯一线索：进册只会对账当前那一册，别的册要等一次全量扫描。
 */
export function markAnnoPending(owner: string): void {
  try {
    Taro.setStorageSync(ANNO_PENDING_KEY(owner), true)
  } catch {
    // 存储不可用：欠账仍可由「本地指纹 ≠ 基线」推导出来，只是少了「主动扫全部」这一层
  }
}

export function isAnnoPending(owner: string): boolean {
  try {
    return Taro.getStorageSync(ANNO_PENDING_KEY(owner)) === true
  } catch {
    return false
  }
}

export function clearAnnoPending(owner: string): void {
  try {
    Taro.removeStorageSync(ANNO_PENDING_KEY(owner))
  } catch {
    /* 清不掉就下次再扫一遍，无害 */
  }
}

/** 列出**这个账号**所有有批注的册（直接数 Storage 的键，不另建一份会漂移的索引） */
export function listAnnotatedFileIds(owner: string): string[] {
  try {
    const info = Taro.getStorageInfoSync()
    const keys = Array.isArray(info?.keys) ? info.keys : []
    const prefix = annoDocPrefix(owner)
    const out: string[] = []
    for (const key of keys) {
      if (typeof key === 'string' && key.startsWith(prefix)) {
        const fileId = key.slice(prefix.length)
        if (fileId) out.push(fileId)
      }
    }
    return out
  } catch {
    return []
  }
}
