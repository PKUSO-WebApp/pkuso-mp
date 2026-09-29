import Taro from '@tarojs/taro'
import { reportClientError } from './error-report'
import { logDiag } from './session-diag'
import {
  activeEntry,
  baseFor,
  hasProxy,
  otherEntry,
  switchTo,
  type EntryName,
} from './supabase-entry'

// ============================================================
// 入口探针。**这是仪器，不修任何东西**（唯一例外见文末「顺带回切」）。
//
// 它回答两个问题：
//
//   1. **手机落哪个机房**（`colo`）—— 「被解析到 LAX 的人」和「报连接重置的人」是不是同一批。
//      这个答案决定境内反代的钱该不该花（实测两条 anycast 记录差 4.2 倍，由客户端 BGP 抽签决定，
//      小程序侧无法干预）。
//   2. **两条入口各自的首字节有多快**（`ttfb` + `entry`）—— 「切到反代会不会更慢」。
//      没有它，我们只能判断「机房那一跳会不会断」，判断不了「值不值得切回去」。
//
// 为什么必须由客户端把结果报上来，而不是事后查库：
// - `/cdn-cgi/trace` 由 Cloudflare 边缘**直接应答、不落 origin**，它的返回永远不会
//   出现在服务端日志里；
// - 而运营商只有服务端知道（edge_logs 的 cf.asOrganization）。
// 两者不在同一条记录里 ⇒ 只能让客户端把 colo 随一次**会落到服务端**的请求带上来，
// 复用现有 client_error_logs（网络类型由 reportClientError 自己附带，不必在这里取）。
//
// ⚠️ **`colo` 的语义随 entry 变了，判读时别混在一起**：
// - `entry=direct` 时，它是**手机**落到的 Cloudflare 机房（这是本探针最初的用途）；
// - `entry=proxy` 时，请求是云函数发出去的，拿到的是**机房**落到的机房
//   （上海出口实测固定 `SIN`）——手机到云开发那一跳根本不经过 Cloudflare。
// 所以「反代那一侧的 colo」不该被读成「用户落到了哪」。
//
// 三条硬约束，改动时别破坏：
// 1. **绝不走 taroFetch**。它是错误上报的载体，探针失败会被记成 `request_failed`——
//    而那正是探针要解释的那份数据，等于自己污染自己的样本；「失败时再探一次」
//    还会因此变成回环。所以这里直接用 Taro.request。
// 2. **探针失败不上报**。它不是用户遇到的失败：失败时连 colo 都拿不到，
//    记下来只是一条无法聚合的噪声。（但失败本身会参与「要不要回切」的判断，见文末。）
// 3. **必须节流**。失败路径可能短时间内连触发，同刻并发只留一个、并按最小间隔丢弃。
// ============================================================

/** Cloudflare 的边缘端点，就在已加白名单的 *.supabase.co 域名下，无需改配置 */
const TRACE_PATH = '/cdn-cgi/trace'

/**
 * 探针自己的超时，比业务请求（8s）短。
 *
 * 它不是用户等着的东西，价值全在「拿到 colo / 量到 ttfb」这两个字段上；拿不到就是没样本，
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

type ProbeOutcome = {
  entry: EntryName
  /** 拿到了可解析的 colo —— 只有这种样本才上报（约束 2） */
  colo: string | null
  loc: string | null
  /**
   * **这一次请求有没有拿到 HTTP 响应**（含 4xx/5xx），与「有没有 colo」是两件事。
   *
   * 回切的判据必须是它，不能是 colo：反代那条路要过 Referer 校验，被挡时是个**正常返回的
   * 403**——链路明明是通的，拿它当「入口不可用」会导致每次启动都误切到直连。
   */
  reachable: boolean
  /** 首字节耗时。拿不到就是 null，此时用 ms 顶着并标 ttfbApprox */
  ttfbMs: number | null
  ms: number
  /** 这一次实际请求的基址。**记它才能看出「配的那个地址对不对」**——只记 entry 看不出来 */
  base: string
  /** 拿到了响应时的状态码（用来区分「403 被挡」和「网络层根本没通」） */
  httpStatus: number | null
  /** 没拿到响应时的原始错误文本（Taro 拒的是一个 `{errMsg}` 对象） */
  errMsg: string | null
}

/**
 * 打一次 `/cdn-cgi/trace`。失败不抛、不上报，全部如实回报在返回值里。
 *
 * `onHeadersReceived` 是**真的首字节时刻**（Taro.request 返回的原生 RequestTask 上有它，
 * 与总耗时不是一回事：trace 的 body 很小，但经过反代时多了一跳 TLS，两者会明显分开）。
 * 平台不给这个方法就退回总耗时，并让调用方标上 `ttfbApprox`。
 */
async function probeOne(entry: EntryName, reason: ColoProbeReason): Promise<ProbeOutcome> {
  const base = baseFor(entry)
  const startedAtMs = Date.now()
  const out: ProbeOutcome = {
    entry,
    colo: null,
    loc: null,
    reachable: false,
    ttfbMs: null,
    ms: 0,
    base,
    httpStatus: null,
    errMsg: null,
  }
  if (!base) return out
  try {
    const task = Taro.request({
      url: `${base}${TRACE_PATH}`,
      timeout: PROBE_TIMEOUT_MS,
    })
    const withHeaders = task as unknown as { onHeadersReceived?: (cb: () => void) => void }
    if (typeof withHeaders.onHeadersReceived === 'function') {
      try {
        withHeaders.onHeadersReceived(() => {
          if (out.ttfbMs === null) out.ttfbMs = Date.now() - startedAtMs
        })
      } catch {
        // 注册失败就当平台没有这个能力，退回总耗时——探针不能因为量不到首字节就不干活
      }
    }
    const res = await task
    out.ms = Date.now() - startedAtMs
    out.reachable = true
    out.httpStatus = typeof res.statusCode === 'number' ? res.statusCode : null
    if (res.statusCode !== 200 || typeof res.data !== 'string') return out
    const { colo, loc } = parseColoTrace(res.data)
    out.colo = colo
    out.loc = loc
    logDiag('colo_probe', { entry, colo, loc, reason, ttfb: out.ttfbMs, ms: out.ms })
    return out
  } catch (err) {
    out.ms = Date.now() - startedAtMs
    // 微信拒的是 `{ errMsg }` 对象、不是 Error 实例（实测踩过，直接 String() 会得到 [object Object]）
    out.errMsg =
      err instanceof Error
        ? err.message
        : ((err as { errMsg?: string } | null)?.errMsg ?? String(err))
    return out
  }
}

/**
 * 探一次并上报。返回 Promise 只为测试能 await；生产调用方一律 `void` 掉。
 */
export async function probeColo(reason: ColoProbeReason): Promise<void> {
  if (inFlight) return
  const now = Date.now()
  if (now - lastProbeAtMs < MIN_INTERVAL_MS) return

  const active = activeEntry()
  const other = otherEntry(active)
  const entries: EntryName[] = other ? [active, other] : [active]
  if (!baseFor(active)) return

  inFlight = true
  lastProbeAtMs = now
  try {
    const outcomes: ProbeOutcome[] = []
    for (const entry of entries) outcomes.push(await probeOne(entry, reason))

    for (const outcome of outcomes) {
      // 约束 2：拿不到 colo 就不上报（失败大概率是设备当时真的没网，那时也没有 colo 可报）
      if (!outcome.colo) continue
      reportClientError({
        event: 'colo_probe',
        // info：它不是错误。混进 error 会让「真正的问题」在库里被稀释——
        // 那正是这轮排查最开始要解决的事
        level: 'info',
        // message 进指纹（event + message），于是**同一台设备同一入口同一 colo** 5 分钟内
        // 只留一条。⚠️ entry 必须进 message：两条入口被并成一条的话，direct/proxy 的
        // 对比就没了——而那正是这次加它的目的。
        message: `entry=${outcome.entry} colo=${outcome.colo}`,
        detail: {
          entry: outcome.entry,
          colo: outcome.colo,
          loc: outcome.loc,
          reason,
          ttfb: outcome.ttfbMs,
          // 平台不给 onHeadersReceived 时 ttfb 是总耗时顶的，标出来免得被当成首字节读
          ...(outcome.ttfbMs === null ? { ttfbApprox: true } : {}),
          ms: outcome.ms,
        },
      })
    }

    // ---- 顺带回切 ----
    //
    // 「探针不修任何东西」在这里有一个有意的例外：**入口的选择本来就是它测的那个量**。
    // 判据只用 reachable（拿到过 HTTP 响应），不用 colo——理由见 ProbeOutcome.reachable。
    //
    // 两条规则：
    //   1. 当前入口不可达、另一个可达 ⇒ 切过去（这是「云开发被风控关停」的兜底）
    //   2. 当前是 direct、而 proxy 可达 ⇒ 切回 proxy。没有这条就回不去了：偏好是持久的，
    //      一次故障之后会永远停在直连上，而直连正是要摆脱的那条路。
    const activeOutcome = outcomes.find((o) => o.entry === active)
    const otherOutcome = other ? outcomes.find((o) => o.entry === other) : undefined
    let target: EntryName | null = null
    if (otherOutcome && activeOutcome && !activeOutcome.reachable && otherOutcome.reachable) {
      target = other
    } else if (hasProxy && active === 'direct') {
      const proxyOutcome = outcomes.find((o) => o.entry === 'proxy')
      if (proxyOutcome?.reachable) target = 'proxy'
    }
    if (target) {
      const record = switchTo(target)
      if (record) {
        reportClientError({
          event: 'entry_switched',
          level: 'warn',
          message: `入口 ${record.from} → ${record.to} @ 启动探针`,
          detail: {
            from: record.from,
            to: record.to,
            reason,
            // 把两边的可达性一起记下来：只看结论的话，事后无法判断这次切换是不是误判
            activeReachable: activeOutcome?.reachable ?? null,
            otherReachable: otherOutcome?.reachable ?? null,
            // ↓ **上一个入口究竟怎么失败的**。约束 2 说「探针失败本身不上报」，那是不让它
            // 混进 request_failed 的样本里；但「这次切换被什么触发」是切换记录的一部分，
            // 不记就只能靠反向排除——真机上出现过一次「切了、但不知道为什么」，绕了很久。
            fromBase: activeOutcome?.base ?? null,
            fromMs: activeOutcome?.ms ?? null,
            fromStatus: activeOutcome?.httpStatus ?? null,
            fromErr: activeOutcome?.errMsg ?? null,
          },
        })
      }
    }
  } finally {
    inFlight = false
  }
}

/** 仅供测试：清掉节流状态，否则用例之间会互相挡住 */
export function __resetColoProbeForTest(): void {
  lastProbeAtMs = 0
  inFlight = false
}
