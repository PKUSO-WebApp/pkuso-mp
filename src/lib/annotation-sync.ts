import Taro from '@tarojs/taro'
import { compactStroke, type AnnoDoc, type AnnoStroke } from './annotation'

/**
 * 批注上云的**纯逻辑**：内容指纹、三方差分、以及两种记账的读写。
 *
 * 这一层不 import supabase（那会在缺 env 时**导入即抛**，测试连模块都加载不了）——
 * 网络那半边在 annotation-sync-runner.ts。两者的分界是「能不能只靠本地状态算出来」。
 *
 * ## 为什么是「指纹对账」而不是时间戳
 *
 * 客户端时钟不可信（时区、漂移、回拨），而「这一页的内容是不是我上次推上去的那份」
 * 用内容本身就能回答：为每册记一份**上次同步成功时每页的指纹**，本地现在算出来的对不上
 * 就是有欠账。这不依赖任何内存态，所以**进程被强杀也不丢**——欠账是可推导的，不是被记住的。
 *
 * ## 为什么冲突要「两边都不动」
 *
 * 「先拉后推」挡掉绝大多数并发；只剩「本地离线改过、同一页在别处也改过」这一种。
 * 那时两边都有用户真花时间画的东西，**静默选一边就是无声地丢**。所以这一页不上传也不覆盖，
 * 分叉留着（本地那份还在本地、服务端那份还在服务端），只上报一条。
 */

/** 上次同步成功时，每页的内容指纹（页码字符串 → 指纹） */
export type SyncBase = Record<string, string>

/** 服务端一行的形态（查询回来的原始行） */
export type RemotePage = { page: number; strokes: AnnoStroke[] }

export const annoSyncKey = (fileId: string) => `score-annotation-sync:${fileId}`

/** 全局「可能有欠账」标记：真时下次联网要把**所有**有批注的册对一遍账 */
export const ANNO_PENDING_KEY = 'score-annotation-pending'

/**
 * 列册用的前缀。注意它与 annoSyncKey 不冲突——`score-annotation-sync:x` 后面跟的是 `-`
 * 而不是 `:`，所以不会以 `score-annotation:` 开头。
 */
const ANNO_KEY_PREFIX = 'score-annotation:'

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

export type SyncPlan = {
  /** 本地改过、远端没动 ⇒ 上传 */
  toPush: Array<{ page: number; strokes: AnnoStroke[]; fp: string }>
  /** 远端改过、本地没动 ⇒ 落回本地 */
  toAdopt: Array<{ page: number; strokes: AnnoStroke[]; fp: string }>
  /** 两边都改过 ⇒ 两边都不动，只上报 */
  conflicts: number[]
  /** 已经一致（含「碰巧改成同一份」）⇒ 把基线推到当前指纹即可 */
  inSync: Array<{ page: number; fp: string }>
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
 * 两边都与基线不同 ⇒ 两边都动过 ⇒ 冲突。
 *
 * 基线**缺失**（这一页从没同步过：功能上线前画的、或离线画的）时只能靠「哪边是空的」判：
 * 一边空一边有内容，方向是明确的；两边都有内容而内容不同，无从判断谁新谁旧 —— 算冲突。
 */
export function planSync(local: AnnoDoc, base: SyncBase, remote: RemotePage[]): SyncPlan {
  const remoteMap = new Map<number, AnnoStroke[]>()
  for (const row of remote) {
    if (!Number.isInteger(row.page) || row.page < 1) continue
    remoteMap.set(row.page, Array.isArray(row.strokes) ? row.strokes : [])
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

  const plan: SyncPlan = { toPush: [], toAdopt: [], conflicts: [], inSync: [] }
  for (const page of [...pages].sort((x, y) => x - y)) {
    const key = String(page)
    const localStrokes = local[key] ?? []
    const remoteStrokes = remoteMap.get(page) ?? []
    const l = pageFingerprint(localStrokes)
    const r = pageFingerprint(remoteStrokes)
    const b = base[key]

    if (l === r) {
      plan.inSync.push({ page, fp: l })
      continue
    }
    if (b === undefined) {
      if (l === EMPTY_FP) plan.toAdopt.push({ page, strokes: remoteStrokes, fp: r })
      else if (r === EMPTY_FP) plan.toPush.push({ page, strokes: localStrokes, fp: l })
      else plan.conflicts.push(page)
      continue
    }
    if (r === b) plan.toPush.push({ page, strokes: localStrokes, fp: l })
    else if (l === b) plan.toAdopt.push({ page, strokes: remoteStrokes, fp: r })
    else plan.conflicts.push(page)
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
export type SyncRecord = { userId: string; base: SyncBase }

export function loadSyncBase(fileId: string, userId: string): SyncBase {
  try {
    const raw = Taro.getStorageSync(annoSyncKey(fileId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const record = parsed as Partial<SyncRecord>
    if (record.userId !== userId) return {}
    if (!record.base || typeof record.base !== 'object' || Array.isArray(record.base)) return {}
    const out: SyncBase = {}
    for (const [k, v] of Object.entries(record.base as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

/** 写基线失败（存储满）只会让下次多推一遍，不影响正确性，故只回布尔不抛 */
export function saveSyncBase(fileId: string, userId: string, base: SyncBase): boolean {
  try {
    const record: SyncRecord = { userId, base }
    Taro.setStorageSync(annoSyncKey(fileId), JSON.stringify(record))
    return true
  } catch {
    return false
  }
}

/**
 * 记「可能有欠账」。**本地每次改动都要调**——它是「离线改了 3 册然后被强杀」能被补上的
 * 唯一线索：进册只会对账当前那一册，别的册要等一次全量扫描。
 */
export function markAnnoPending(): void {
  try {
    Taro.setStorageSync(ANNO_PENDING_KEY, true)
  } catch {
    // 存储不可用：欠账仍可由「本地指纹 ≠ 基线」推导出来，只是少了「主动扫全部」这一层
  }
}

export function isAnnoPending(): boolean {
  try {
    return Taro.getStorageSync(ANNO_PENDING_KEY) === true
  } catch {
    return false
  }
}

export function clearAnnoPending(): void {
  try {
    Taro.removeStorageSync(ANNO_PENDING_KEY)
  } catch {
    /* 清不掉就下次再扫一遍，无害 */
  }
}

/** 列出本机所有有批注的册（直接数 Storage 的键，不另建一份会漂移的索引） */
export function listAnnotatedFileIds(): string[] {
  try {
    const info = Taro.getStorageInfoSync()
    const keys = Array.isArray(info?.keys) ? info.keys : []
    const out: string[] = []
    for (const key of keys) {
      if (typeof key === 'string' && key.startsWith(ANNO_KEY_PREFIX)) {
        const fileId = key.slice(ANNO_KEY_PREFIX.length)
        if (fileId) out.push(fileId)
      }
    }
    return out
  } catch {
    return []
  }
}
