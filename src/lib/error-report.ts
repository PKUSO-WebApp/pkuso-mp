// 客户端错误在线收集：把 error 级日志写进 Supabase 的 client_error_logs 表。
//
// 为什么需要它：排查「少数用户无法微信登录」时，服务端三层（Edge Function / auth /
// PostgREST）查下来全绿、一条失败记录都没有，而失败用户那边连请求都没到达——客户端侧的
// 失败在两端都不可见（现有手段只有要手动导出文件的 session-diag，且默认关闭）。
// 于是有了这条「用户那里出错 → 自动回到库里」的通道，让复现不了的故障也能自证。
//
// 设计约束（按免费计划 500MB 库容 / 90 天保留推算，见 migration 20260927120000）：
// - **本地队列**：错误发生时可能正好断网——而那恰恰是最该记下来的时刻。直接用
//   网络去报告网络故障是个悖论，所以每条记录先写进本地 storage 队列（同步、不依赖
//   网络），再尝试送出：成功即清空，网络失败则留在队列，等下次冷启动或网络恢复补送。
// - 指纹去重：同一 (event, message 前缀) 在 DEDUP_WINDOW_MS 内只报一次。防的是循环报错
//   把库写爆——存储评估里唯一会失控的场景（心跳类定时器一旦接上上报就是几千条/天/人）。
// - 长度截断：与库端 CHECK 约束对齐（message ≤ 500 字符、detail ≤ 4096 字节），
//   超限的报文会被数据库直接拒绝，不如在客户端先削。
// - 绝不影响业务：不 await、失败静默。上报自身抛错会被 app.ts 的 onUnhandledRejection
//   再抓一次，形成「上报→失败→上报」的循环，因此这里所有出口都必须吞错。
import Taro from '@tarojs/taro'
import type { Json } from '@/types/database.types'
import { supabase } from './supabase'

export type ErrorLevel = 'error' | 'warn' | 'info'

export type ReportInput = {
  /** 稳定错误标识，便于聚合（如 'wechat_login' / 'unhandled_rejection'） */
  event: string
  level?: ErrorLevel
  message?: string
  /** 上下文：errMsg / 错误码 / 栈等 */
  detail?: Record<string, unknown>
}

// 同一指纹的去重窗口
const DEDUP_WINDOW_MS = 5 * 60 * 1000
// 最多记住多少个指纹（超出后丢最旧的一半，避免无界增长）
const MAX_TRACKED_FINGERPRINTS = 100
// 与库端 CHECK 对齐
const MAX_MESSAGE_LEN = 500
const MAX_EVENT_LEN = 64
const MAX_PAGE_LEN = 128
const MAX_PLATFORM_LEN = 64
const MAX_DETAIL_BYTES = 4096
// detail 内单字段的字符上限（栈往往最长）
const MAX_DETAIL_STRING_LEN = 800

// --- 本地待发队列 ---
const QUEUE_KEY = 'pkuso_error_queue'
// 队列上限：超出丢最旧的。50 条 × 约 1KB ≈ 50KB，Taro storage 上限 10MB，毫无压力
const MAX_QUEUE = 50
// 超过这个年龄的记录直接丢弃（陈旧到没有诊断价值的，不值得占用队列）
const MAX_QUEUE_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** 队列里的一条 = client_error_logs 的一行（含「发生时刻」，不是发送时刻） */
type QueueItem = {
  created_at: string
  level: ErrorLevel
  source: 'mp'
  event: string
  message: string | null
  detail: Json | null
  app_version: string | null
  platform: string | null
  page: string | null
}

const lastSentAt = new Map<string, number>()

function fingerprint(event: string, message: string): string {
  return `${event}::${message.slice(0, 120)}`
}

/** 记录并判断该指纹是否已过窗口；返回 true 表示本次应当上报 */
function shouldSend(fp: string, now: number): boolean {
  const last = lastSentAt.get(fp)
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) return false
  lastSentAt.set(fp, now)
  if (lastSentAt.size > MAX_TRACKED_FINGERPRINTS) {
    // Map 保持插入序：删掉最早的一半
    const stale = Array.from(lastSentAt.keys()).slice(0, MAX_TRACKED_FINGERPRINTS / 2)
    for (const key of stale) lastSentAt.delete(key)
  }
  return true
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max)
}

function normalizeValue(value: unknown): Json {
  if (typeof value === 'string') return truncate(value, MAX_DETAIL_STRING_LEN)
  // NaN / Infinity 不是合法 JSON，落成 null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 20).map(normalizeValue)
  if (value && typeof value === 'object') {
    const out: Record<string, Json> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 20)) {
      out[truncate(key, 64)] = normalizeValue(item)
    }
    return out
  }
  // 函数 / symbol / undefined / bigint 等无法 JSON 化的值统一落成 null
  return null
}

/**
 * 把 detail 削到库端上限以内。jsonb 的实际占用由 pg_column_size 判定，这里用 JSON
 * 文本长度近似（留出结构开销余量）。
 *
 * 顺序：先把每个字段各自截断（normalizeValue），再按原顺序逐字段累加、放不下就停。
 * 「宁可只留前面的几个字段，也不要整块丢成一句 keys」——调用方按重要性排列字段
 * （step / errMsg 在前，stack 在后），所以前缀本身通常就够定位了。
 */
function fitDetail(detail: Record<string, unknown> | undefined): Json | null {
  if (!detail) return null
  const normalized = normalizeValue(detail) as Record<string, Json>
  if (JSON.stringify(normalized).length <= MAX_DETAIL_BYTES) return normalized

  const kept: Record<string, Json> = {}
  let size = 2 // 外层花括号
  for (const [key, value] of Object.entries(normalized)) {
    const piece = JSON.stringify({ [key]: value }).length
    // 留 32 字符给尾部的截断标记
    if (size + piece > MAX_DETAIL_BYTES - 32) break
    kept[key] = value
    size += piece
  }
  kept.detail_truncated = true

  // 兜底：极端情况下连一个字段都放不下（理论上不会——单字段已限 800 字符）
  if (JSON.stringify(kept).length > MAX_DETAIL_BYTES) {
    return { detail_too_large: true, keys: Object.keys(detail).slice(0, 20).join(',') }
  }
  return kept
}

/**
 * 取错误的人类可读文本。
 *
 * 微信的 Taro.request 失败时 reject 的**不是 Error 实例**，而是 `{ errMsg }` 对象——
 * 直接走 `instanceof Error ? err.message : String(err)` 只会得到 "[object Object]"，
 * 库里就只剩「哪个端点挂了」这半条信息（实测踩过）。
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  const e = err as { errMsg?: unknown; message?: unknown; error?: unknown } | null
  const text = e?.errMsg ?? e?.message ?? e?.error
  return typeof text === 'string' && text ? text : String(err)
}

function collectContext(): {
  platform: string | null
  page: string | null
  appVersion: string | null
} {
  let platform: string | null = null
  try {
    // platform（ios / android / devtools）从 getDeviceInfo 取。
    // 曾用 getSystemInfoSync——它已被微信废弃，每次调用都会在控制台刷一条 deprecation 告警。
    const info = Taro.getDeviceInfo?.() as { platform?: string } | undefined
    platform = info?.platform ? truncate(String(info.platform), MAX_PLATFORM_LEN) : null
  } catch {
    // 取不到就不带
  }
  let page: string | null = null
  try {
    const pages = Taro.getCurrentPages?.() ?? []
    const route = pages[pages.length - 1]?.route
    page = route ? truncate(String(route), MAX_PAGE_LEN) : null
  } catch {
    // 同上
  }
  const appVersion = typeof APP_VERSION !== 'undefined' ? APP_VERSION : null
  return { platform, page, appVersion }
}

// --- 本地队列的读写与补送 ---

function readQueue(): QueueItem[] {
  try {
    const raw = Taro.getStorageSync(QUEUE_KEY)
    if (typeof raw !== 'string' || !raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as QueueItem[]) : []
  } catch {
    return []
  }
}

function writeQueue(items: QueueItem[]): void {
  try {
    if (items.length === 0) Taro.removeStorageSync(QUEUE_KEY)
    else Taro.setStorageSync(QUEUE_KEY, JSON.stringify(items))
  } catch {
    // 存储不可用（配额满 / 隐私模式等）：放弃排队，但绝不能因此影响业务
  }
}

function enqueue(item: QueueItem): void {
  const now = Date.now()
  const kept = readQueue()
    .filter((x) => {
      const t = Date.parse(x.created_at)
      return Number.isFinite(t) && now - t < MAX_QUEUE_AGE_MS
    })
    .concat(item)
    // 超限丢最旧的：保留最后 MAX_QUEUE 条
    .slice(-MAX_QUEUE)
  writeQueue(kept)
}

let flushing = false

/** 队列项的身份键：同一条记录唯一（created_at 精确到毫秒） */
function itemKey(item: QueueItem): string {
  return `${item.created_at}|${item.event}|${item.message ?? ''}`
}

/** 只移除已送达的那些，保留 flush 期间新入队的 */
function removeSent(sent: QueueItem[]): void {
  const sentKeys = new Set(sent.map(itemKey))
  writeQueue(readQueue().filter((x) => !sentKeys.has(itemKey(x))))
}

/**
 * 把本地队列送出去。触发点：每次上报后、冷启动、网络恢复（见 app.ts）。
 *
 * 成败处理刻意不对称：
 * - **网络层失败** → 保留队列，等下次补送。这是队列存在的理由。
 * - **服务端拒绝**（通常 4xx）→ 丢弃**本批**并留痕。这类是「毒丸」，重试一万次也不会
 *   成功，留着会永久堵死排在它后面的记录；客户端已按库端上限截断过，真走到这里说明
 *   约束或权限有变，值得在 console 里露一面。
 *
 * ⚠️ 区分二者的依据是 **`res.status`，不能是「res.error 是否非空」**：
 * postgrest-js 在 supabase-js 默认配置（shouldThrowOnError=false）下，把**网络失败**
 * 也包装成 `{ data: null, error, status: 0 }` 并 **resolve** —— 也就是说下面那个 reject
 * 回调对网络故障根本不会被走到。曾经按「error 非空即服务端拒绝」处理，结果断网期间的
 * 记录被成批丢弃，而那恰恰是最该留下的那批（实测：一次断网丢掉整队列，只剩另一批侥幸送达）。
 *
 * ⚠️ 两个都不能用「清空队列」收尾：发送期间（异步窗口内）新报上来的记录会排在队尾，
 * 清空会把它们一并抹掉——那些记录既没送出去、也没留下，等于凭空丢失。
 */
export function flushErrorQueue(): void {
  if (flushing) return
  const queue = readQueue()
  if (queue.length === 0) return
  flushing = true
  const sending = queue.slice()
  try {
    void supabase
      .from('client_error_logs')
      .insert(sending)
      .then(
        (res) => {
          flushing = false
          // status 0 = 网络层失败/中断（postgrest 的网络分支恒填 0）→ 保留队列等重试
          if (res?.status === 0) return
          if (res?.error) {
            // eslint-disable-next-line no-console
            console.error('[error-report] 队列被服务端拒绝，已丢弃：', res.error.message)
          }
          removeSent(sending)
        },
        () => {
          // 网络不通：留在队列里，等下次冷启动 / 网络恢复
          flushing = false
        }
      )
  } catch {
    // 构造请求时就同步抛错：保留队列，且必须复位守卫——否则后面所有 flush 都会被跳过
    flushing = false
  }
}

/**
 * 上报一条客户端错误。同步返回、不抛出、不阻塞调用方——
 * 调用点（错误处理路径）不应该因为「记录错误」而产生新的错误。
 *
 * 先入队再发送：入队是同步的本地写，不依赖网络，所以即使此刻完全断网，
 * 记录也不会丢——这正是「错误发生时恰好断网」这一最需要记录的场景。
 */
export function reportClientError(input: ReportInput): void {
  try {
    const message = truncate(String(input.message ?? ''), MAX_MESSAGE_LEN)
    const now = Date.now()
    if (!shouldSend(fingerprint(input.event, message), now)) return

    const ctx = collectContext()
    enqueue({
      // 用错误发生时刻，不是发送时刻：断网恢复后补送时，库里仍能还原真实时间线
      created_at: new Date(now).toISOString(),
      level: input.level ?? 'error',
      source: 'mp',
      event: truncate(input.event, MAX_EVENT_LEN),
      message: message || null,
      detail: fitDetail(input.detail),
      app_version: ctx.appVersion,
      platform: ctx.platform,
      page: ctx.page,
    })
    flushErrorQueue()
  } catch {
    // 上报自身绝不能影响业务，也绝不能抛出（会被 onUnhandledRejection 再抓一次）
  }
}

/** 仅供测试：清空去重状态与待发队列 */
export function __resetErrorReportState(): void {
  lastSentAt.clear()
  writeQueue([])
}
