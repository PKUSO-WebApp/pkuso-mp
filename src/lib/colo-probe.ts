import Taro from '@tarojs/taro'
import { reportClientError } from './error-report'
import { logDiag } from './session-diag'

// ============================================================
// Cloudflare PoP 探针。**这是仪器，不修任何东西。**
//
// 它要回答的是整轮排查里唯一还没有答案的问题：
//   「被解析到 LAX 的人」和「报 ERR_CONNECTION_RESET 的人」是不是同一批。
// 这个答案决定境内反代（#6）的钱该不该花——实测两条 anycast 记录差 4.2 倍
// （HKG 49ms / LAX 206ms），由客户端 BGP 抽签决定，小程序侧无法干预。
//
// 为什么必须由客户端把结果报上来，而不是事后查库：
// - `/cdn-cgi/trace` 由 Cloudflare 边缘**直接应答、不落 origin**，它的返回永远不会
//   出现在服务端日志里；
// - 而运营商只有服务端知道（edge_logs 的 cf.asOrganization）。
// 两者不在同一条记录里 ⇒ 只能让客户端把 colo 随一次**会落到服务端**的请求带上来，
// 复用现有 client_error_logs（网络类型由 reportClientError 自己附带，不必在这里取）。
//
// 三条硬约束，改动时别破坏：
// 1. **绝不走 taroFetch**。它是错误上报的载体，探针失败会被记成 `request_failed`——
//    而那正是探针要解释的那份数据，等于自己污染自己的样本；「失败时再探一次」
//    还会因此变成回环。所以这里直接用 Taro.request。
// 2. **探针失败不上报**。它不是用户遇到的失败：失败时连 colo 都拿不到，
//    记下来只是一条无法聚合的噪声。
// 3. **必须节流**。失败路径可能短时间内连触发，同刻并发只留一个、并按最小间隔丢弃。
// ============================================================

/** Cloudflare 的边缘端点，就在已加白名单的 *.supabase.co 域名下，无需改配置 */
const TRACE_PATH = '/cdn-cgi/trace'

/**
 * 探针自己的超时，比业务请求（8s）短。
 *
 * 它不是用户等着的东西，价值全在「拿到 colo」这一个字段上；拿不到就是没样本，
 * 而拖着一个挂起 8 秒的请求只会占掉微信并发额度（wx.request 上限 10）。
 */
const PROBE_TIMEOUT_MS = 5000

/** 同一台设备两次探针的最小间隔（在飞期间也一并挡住） */
const MIN_INTERVAL_MS = 60_000

/** 采样时机。launch 供全天分布；failure 负责把「这一次失败」和「当时落在哪个 PoP」对上 */
export type ColoProbeReason = 'launch' | 'failure'

let lastProbeAtMs = 0
let inFlight = false

/**
 * 解析 `/cdn-cgi/trace` 的响应体——纯文本的 `key=value` 行，形如：
 *
 * ```
 * fl=123abc
 * h=xxxx.supabase.co
 * ip=1.2.3.4
 * colo=HKG
 * loc=HK
 * ```
 *
 * 只取 `colo` / `loc` 两个字段：其余（ip / uag / tls…）要么与本次调查无关，
 * 要么属于不该往库里写的设备指纹。取不到就返回 null，由调用方决定丢弃。
 */
export function parseColoTrace(text: string): { colo: string | null; loc: string | null } {
  const fields: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=')
    // eq <= 0 同时排除空行与以 '=' 开头的畸形行
    if (eq <= 0) continue
    fields[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  const colo = fields.colo ? fields.colo.toUpperCase().slice(0, 8) : null
  const loc = fields.loc ? fields.loc.toUpperCase().slice(0, 8) : null
  return { colo, loc }
}

/**
 * 探一次当前落点并上报。返回 Promise 只为测试能 await；生产调用方一律 `void` 掉。
 *
 * 失败静默：拿不到 colo 就什么都不做（约束 2）。
 */
export async function probeColo(reason: ColoProbeReason): Promise<void> {
  const base = process.env.TARO_APP_SUPABASE_URL
  if (!base) return
  if (inFlight) return
  const now = Date.now()
  if (now - lastProbeAtMs < MIN_INTERVAL_MS) return
  inFlight = true
  lastProbeAtMs = now
  try {
    const res = await Taro.request({
      url: `${base.replace(/\/+$/, '')}${TRACE_PATH}`,
      timeout: PROBE_TIMEOUT_MS,
    })
    if (res.statusCode !== 200 || typeof res.data !== 'string') return
    const { colo, loc } = parseColoTrace(res.data)
    if (!colo) return
    logDiag('colo_probe', { colo, loc, reason })
    reportClientError({
      event: 'colo_probe',
      // info：它不是错误。混进 error 会让「真正的问题」在库里被稀释——
      // 那正是这轮排查最开始要解决的事
      level: 'info',
      // message 进指纹（event + message），于是同一台设备同一 colo 5 分钟内只留一条：
      // 既压住了重复，又不会让一天里早上落 HKG、晚上落 LAX 的采样被吃掉
      message: `colo=${colo}`,
      detail: { colo, loc, reason },
    })
  } catch {
    // 约束 2：探针失败不上报（大概率是设备当时真的没网，那时也没有 colo 可报）
  } finally {
    inFlight = false
  }
}

/** 仅供测试：清掉节流状态，否则用例之间会互相挡住 */
export function __resetColoProbeForTest(): void {
  lastProbeAtMs = 0
  inFlight = false
}
