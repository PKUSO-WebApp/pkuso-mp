// 客户端错误在线收集：把 error 级日志写进 Supabase 的 client_error_logs 表。
//
// 为什么需要它：排查「少数用户无法微信登录」时，服务端三层（Edge Function / auth /
// PostgREST）查下来全绿、一条失败记录都没有，而失败用户那边连请求都没到达——客户端侧的
// 失败在两端都不可见（现有手段只有要手动导出文件的 session-diag，且默认关闭）。
// 于是有了这条「用户那里出错 → 自动回到库里」的通道，让复现不了的故障也能自证。
//
// 设计约束（按免费计划 500MB 库容 / 90 天保留推算，见 migration 20260927120000）：
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

function collectContext(): { platform: string | null; page: string | null; appVersion: string | null } {
  let platform: string | null = null
  try {
    // platform（ios / android / devtools）只在 getSystemInfoSync 上，
    // getAppBaseInfo 没有这个字段
    const info = Taro.getSystemInfoSync?.() as { platform?: string } | undefined
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

/**
 * 上报一条客户端错误。同步返回、不抛出、不阻塞调用方——
 * 调用点（错误处理路径）不应该因为「记录错误」而产生新的错误。
 */
export function reportClientError(input: ReportInput): void {
  try {
    const message = truncate(String(input.message ?? ''), MAX_MESSAGE_LEN)
    const now = Date.now()
    if (!shouldSend(fingerprint(input.event, message), now)) return

    const ctx = collectContext()
    void supabase
      .from('client_error_logs')
      .insert({
        level: input.level ?? 'error',
        source: 'mp',
        event: truncate(input.event, MAX_EVENT_LEN),
        message: message || null,
        detail: fitDetail(input.detail),
        app_version: ctx.appVersion,
        platform: ctx.platform,
        page: ctx.page,
      })
      .then(
        () => undefined,
        () => undefined
      )
  } catch {
    // 上报自身绝不能影响业务，也绝不能抛出（会被 onUnhandledRejection 再抓一次）
  }
}

/** 仅供测试：清空去重状态 */
export function __resetErrorReportState(): void {
  lastSentAt.clear()
}
