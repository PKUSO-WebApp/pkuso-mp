// 必须为首个 import：小程序 JSCore 无全局 Headers，supabase-js 模块初始化
// 会裸引用它导致启动即崩（ReferenceError: Headers is not defined），
// 此副作用 import 按声明顺序先于 @supabase/supabase-js 求值安装 polyfill
// （用 @/ 别名而非相对路径：import/first 规则要求绝对导入在前，别名不算相对）
import '@/lib/weapp-polyfills'
import Taro from '@tarojs/taro'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { logDiag } from './session-diag'
import { DIAG_HEADER, newDiagId } from './diag'
import {
  activeEntry,
  directBase,
  otherEntry,
  rewriteTo,
  rewriteToActive,
  switchTo,
  type EntryName,
} from './supabase-entry'

const supabaseUrl = process.env.TARO_APP_SUPABASE_URL
const supabaseAnonKey = process.env.TARO_APP_SUPABASE_ANON_KEY
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '缺少 Supabase 配置：请在 .env.development/.env.production 配置 TARO_APP_SUPABASE_URL/TARO_APP_SUPABASE_ANON_KEY'
  )
}

const storage = {
  getItem: async (key: string) => {
    try {
      const result = await Taro.getStorage({ key })
      return typeof result.data === 'string' ? result.data : null
    } catch {
      return null
    }
  },
  setItem: async (key: string, value: string) => {
    await Taro.setStorage({ key, data: value })
  },
  removeItem: async (key: string) => {
    await Taro.removeStorage({ key })
  },
}

// --- 请求失败的统一上报口 ---
//
// taroFetch 是所有 Supabase 请求（REST / auth / functions / storage）的唯一出口，
// 在这里接住失败就等于**全站覆盖**，不必逐个 hook 埋点——业务 hook 大多自己 catch
// 了错误（不会冒泡到 onUnhandledRejection），逐个埋既漏又难维护。
//
// 之所以用「注入」而不是直接 import error-report：后者依赖 supabase（要 insert 队列），
// 互相 import 会成环。由 app.ts 在启动时注入。
type RequestFailureReporter = (input: {
  event: string
  level: 'error' | 'warn'
  message: string
  detail: Record<string, unknown>
}) => void

let requestFailureReporter: RequestFailureReporter | null = null

/** 由 app.ts 注入（漏注入 = 请求失败不再上报，故只此一处，注释在此看守） */
export function setRequestFailureReporter(fn: RequestFailureReporter): void {
  requestFailureReporter = fn
}

// 上报端点自身绝不再上报：网络故障时若连上报请求都失败，会形成 上报→失败→上报 的循环
const ERROR_REPORT_PATH = '/rest/v1/client_error_logs'

// 请求成功 = 网络确实可用。这是「断网恢复」最可靠的信号：onNetworkStatusChange 在
// 开发者工具模拟离线时未必触发（工具模拟的是请求失败，不一定改系统网络状态），
// 而任何一次成功的业务请求都必然意味着网通了。由 app.ts 注入为 flushErrorQueue
// （队列为空时它立即返回，所以挂在每个成功请求上也无额外开销）。
let requestSuccessHook: (() => void) | null = null

export function setRequestSuccessHook(fn: () => void): void {
  requestSuccessHook = fn
}

function reportRequestFailure(
  event: string,
  url: string,
  method: string,
  message: string,
  level: 'error' | 'warn',
  extra: Record<string, unknown> = {}
): void {
  if (!requestFailureReporter) return
  if (url.includes(ERROR_REPORT_PATH)) return
  const path = urlPath(url).slice(0, 120)
  try {
    requestFailureReporter({
      event,
      level,
      // message 里带上路径：指纹是「event + message 前缀」，于是不同端点的失败各算一条，
      // 而同一端点的重复失败仍被去重挡掉——这正是我们想要的粒度
      message: `${message} @ ${path}`,
      // extra 排在后面：detail 超预算时是按顺序截断的（见 error-report 的 fitDetail），
      // 最长的 errRaw 必须最后放，否则会把 diag / 状态码这些短字段挤掉
      detail: { urlPath: path, method, ...extra },
    })
  } catch {
    // 上报绝不能反过来影响请求本身
  }
}

/**
 * 把 reject 到的**整个**对象序列化成可入库的短文本。
 *
 * 只取 `errMsg` 会漏：实测微信的网络失败只给一句光秃秃的 `request:fail`（DNS 解析
 * 失败 / 连接重置 / 超时这些原因都不在里面），而别的原因很可能挂在同一个对象的其它
 * 字段上。宁可多留一坨文本，也别再来一次「只有半条信息」。
 *
 * 用 try 兜住 JSON.stringify：循环引用会抛，而这里的契约是「绝不能反过来影响请求」。
 */
function stringifyErr(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  try {
    return JSON.stringify(err) ?? String(err)
  } catch {
    return String(err)
  }
}

/**
 * 单次请求的超时上限（毫秒）。
 *
 * 与后端 Edge Function 的上游超时 `UPSTREAM_TIMEOUT_MS`（login-with-code/index.ts）取同一
 * 个数：客户端和服务端对「多久算挂死」用同一个口径，排查时才不用做单位换算。
 *
 * ⚠️ **超时只能走 Taro.request 自带的 `timeout`，不要改用 supabase-js 的 `db: { timeout }`**：
 * 后者的 postgrest 实现用裸的全局 `new AbortController()`，而小程序 JSCore 没有它
 * （weapp-polyfills 明确未补），配上会让**每个** PostgREST 请求在 fetch 包装层同步抛
 * `ReferenceError` → 被当网络错误 → GET 白等 3 次退避 → 最后以 `status: 0` **resolve**。
 * 表现是「每个请求都失败，但没人抛错」，而且它只管 PostgREST，auth / functions / storage
 * 照样无限挂起。Taro.request 的 timeout 是原生能力，且覆盖全部出口。
 */
const REQUEST_TIMEOUT_MS = 8000

/**
 * Storage（`/storage/v1/`）的独立超时，比 API 宽一个数量级。
 *
 * 为什么不能和 API 用同一个数：taroFetch 也是 Storage 上传/下载的**唯一出口**，而这类
 * 请求是「字节搬运」，耗时随体积线性增长而不是随网络质量抖动。库里现存的谱务文件平均
 * 每个约 1.2MB —— 3G 下传一个就要 10 秒上下，用 8 秒会把慢网用户的大文件**稳定判死**。
 * 反过来 API 请求要的恰恰是「尽快失败好让用户重试」，所以两档分开取值。
 *
 * 取值就是微信 `wx.request` 的平台默认值（60s）——即「不给这类请求加额外约束」，
 * 只是把它显式写出来。
 */
const STORAGE_TIMEOUT_MS = 60000

// --- 网络层重试 ---
//
// 为什么要在这一层重试：postgrest-js 有内建重试，但它 (a) 只对幂等方法
// （`RETRYABLE_METHODS = ['GET','HEAD','OPTIONS']`）、(b) 只覆盖 `/rest/v1` ——
// `/auth/v1`、`/functions/v1`、`/storage/v1` 三条出口完全享受不到。所以它在
// createClient 里被显式关掉了（见 `db.retry`），重试统一收到这里来。
//
// 上限怎么定的：最坏情况单次调用 3 次尝试（原来 1 次），且**只对快失败**生效——
// 慢失败（挂起/超时）一次都不重试。理由见下面的 RETRY_SLOW_MS。
const RETRY_MAX_ATTEMPTS = 3
/** 可变是为了测试能清零（见 __setRetryDelaysForTest）——生产路径只读不改 */
let retryDelaysMs = [500, 1500]
/** 三次尝试 + 退避的总时间上限，防止「超时 + 退避 + 超时」把首屏拖到十几秒 */
const RETRY_BUDGET_MS = 12000
/**
 * 超过这个耗时的失败不重试。
 *
 * 这是「不把弱网请求数放大」最有效的一条：耗时长的失败说明是**挂起**而不是
 * 「链路立刻不通」——后者重试有意义（换个时机可能就通了），前者重试只是再等一个
 * 超时。仓库本来就靠 `ms` 区分这两种病（见下面失败分支的注释）。
 * 顺带地，8 秒/60 秒的超时必然落在这一档，所以**超时的请求天然不会重试**。
 */
const RETRY_SLOW_MS = 4000

/**
 * 「只读 POST」白名单——**必须白名单，不能按方法一刀切**。
 *
 * 为什么不能只重试 GET：`rpc()` 在 postgrest 里走的是 **POST**
 * （PostgrestClient 无对象参数时落到 `method='POST'`），所以「只重试 GET」会把所有
 * RPC 排除，包括纯读的那几个——而它们恰恰最该重试。
 *
 * 为什么不能放宽成「重试所有 POST」：POST 里绝大多数**不能**重试，而且后果不是变慢而是出错：
 * - `/rest/v1/rpc/touch_session`：会**轮换** `profiles.session_token`。多轮换一次，
 *   两次响应乱序时本地存的就不是 DB 最新值 → verifySession 判为「被踢」→ 弹强制下线
 *   并清本机会话。**这是唯一能造成「用户莫名被登出」的路径。**
 * - `POST /rest/v1/<表>`：全是 insert，库端没有幂等键 → 重复请假单 / 重复帖子。
 * - `functions/v1/wechat-auth` 与 `register-with-wechat`：入参是**一次性** wx code，
 *   重试必然拿作废的 code 再问一次，把「其实成功了」显示成失败。
 * - `login-with-code` / `verify-and-update`：验证码一次性消耗，重试会显示「验证码已使用」，
 *   而用户其实已经改成功了（改邮箱场景尤其危险）。
 * - `send-login-code` / `send-verification-code`：真发信，且服务端有 60 秒 IP 冷却。
 * - `wechat-content-check` / `llm-analyze` / `ocr-analyze` / `segment-parts`：外部**计费**调用。
 * - `/storage/v1/object/*` 上传：path 随机，重试可能留孤儿对象。
 * - `/auth/v1/token*`：auth-js 自己已经在重试；且 refresh_token 是旋转型凭据，
 *   重试有触发 GoTrue reuse-detection 而吊销整个 session family 的风险。
 *
 * 导出是为了让用例能断言「白名单里的每一条都有对应的重试次数断言」——往这里加路径
 * 而没加用例，测试会红。**漏掉一条的代价不是变慢，是把上面这些副作用真的执行两遍。**
 */
export const RETRYABLE_READ_POSTS = [
  '/rest/v1/rpc/check_data_versions',
  '/rest/v1/rpc/get_my_session',
  // 收益最高的一条：它失败时 routeAfterLogin 会把已审核通过的成员降级扔到「等待审核」页
  '/rest/v1/rpc/get_my_profile_entry',
]

/** 请求路径（去掉 origin 与 query，与失败指纹同口径） */
function urlPath(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
}

function isRetryable(method: string, url: string): boolean {
  const upper = method.toUpperCase()
  if (upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS') return true
  if (upper !== 'POST') return false
  return RETRYABLE_READ_POSTS.includes(urlPath(url))
}

/** 第 n 次尝试失败后的等待：指数退避 + 全抖动（避免同刻失败的请求同时回来） */
function backoffMs(attempt: number): number {
  const base = retryDelaysMs[attempt - 1] ?? retryDelaysMs[retryDelaysMs.length - 1]
  return base + Math.floor(Math.random() * base)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 仅供测试：把退避延迟清零。
 *
 * 不清零的话，每个「会重试」的用例都要为退避真等 2 秒上下——而用例要验证的是
 * **哪些请求会重试、失败记几条**，与等待多久无关。
 */
export function __setRetryDelaysForTest(delays: number[]): void {
  retryDelaysMs = delays
}

export const taroFetch: typeof fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : 'url' in input ? input.url : input.toString()
  const method =
    init.method ?? (typeof input === 'string' || !('method' in input) ? 'GET' : input.method)
  const headers: Record<string, string> = {}
  if (typeof Headers !== 'undefined' && init.headers instanceof Headers) {
    init.headers.forEach((value, key) => {
      headers[key] = value
    })
  } else if (Array.isArray(init.headers)) {
    for (const [key, value] of init.headers) headers[key] = value
  } else if (init.headers) {
    Object.assign(headers, init.headers)
  }
  // 兜底注入 apikey：无论上层哪一环丢了（supabase-js 的 fetch 包装层 / Headers
  // 构造 / 头名大小写差异），出口处强制保证 PostgREST 不报
  // 「No API key found in request」（用户实测 RPC 出现该 400）
  const hasApikey = Object.keys(headers).some((key) => key.toLowerCase() === 'apikey')
  if (!hasApikey) headers.apikey = supabaseAnonKey
  // 关联 id（见 lib/diag.ts）：服务端把它写进每条函数日志，失败时客户端把**同一个值**
  // 写进 cel —— 两边一对，「请求有没有送到」就不用再猜了。
  // 调用方自己带了的就用它的：登录链路要拿同一个值去写失败记录，得由它决定。
  const diagKey = Object.keys(headers).find((key) => key.toLowerCase() === DIAG_HEADER)
  const diag = diagKey ? headers[diagKey] : newDiagId()
  if (!diagKey) headers[DIAG_HEADER] = diag
  const body = await toTaroBody(init.body)
  // 会话诊断：auth 端点 / 单会话 RPC / 失败请求必记（低噪过滤），定位登录丢失附近的网络事件
  const shortUrl = url.replace(/^https?:\/\/[^/]+/, '').slice(0, 160)
  const isAuthUrl = url.includes('/auth/v1/')
  const isSessionRpc = url.includes('touch_session') || url.includes('get_my_session')
  // 超时按出口分档（理由见 STORAGE_TIMEOUT_MS）。timedOut 的判定**必须用同一个值**，
  // 否则 Storage 那一档会把「正常的 20 秒大文件传输」误标成超时，进而喂错重试逻辑。
  const timeoutMs = url.includes('/storage/v1/') ? STORAGE_TIMEOUT_MS : REQUEST_TIMEOUT_MS
  const canRetry = isRetryable(method, url)

  // --- 走哪个入口（定义见 lib/supabase-entry）---
  //
  // Storage 固定走直连，**不重写**：谱务文件是「字节搬运」，过云函数既吃它的 body 上限
  // 又多一跳，而这类请求的失败表现是「谱子打不开」而不是「登不上」——不值得为它引入
  // 第二条到达路径。基址本来就是直连，所以这里什么都不用做。
  const isStorageUrl = url.includes('/storage/v1/')
  let currentEntry: EntryName = isStorageUrl ? 'direct' : activeEntry()
  let requestUrl = isStorageUrl ? url : rewriteToActive(url)
  /** 本次请求是否已经换过入口。换过就不再换第二次——一次请求里两个域名各撞一遍已经够了 */
  let switchedEntry = false

  const totalStartedAtMs = Date.now()
  let attempt = 0

  for (;;) {
    attempt += 1
    const attemptStartedAtMs = Date.now()
    // 换入口那一次是**最后一次机会**，超时压到剩余预算内：8 秒挂死之后再给另一个入口
    // 完整的 8 秒，首屏就被拖到十几秒了——而 RETRY_BUDGET_MS 存在的意义正是守住这条线。
    const attemptTimeoutMs = switchedEntry
      ? Math.max(2000, RETRY_BUDGET_MS - (attemptStartedAtMs - totalStartedAtMs))
      : timeoutMs
    try {
      const response = await Taro.request({
        url: requestUrl,
        method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        header: headers,
        data: body,
        responseType: 'arraybuffer',
        // 没有它，挂起的请求会一直挂着（实测：一次登录点击等了 8 分 44 秒才发出请求）；
        // 超时后微信给的是 `request:fail timeout`，与 DNS 失败同形，故在失败分支自标 timedOut
        timeout: attemptTimeoutMs,
      })
      const ms = Date.now() - attemptStartedAtMs
      if (isAuthUrl || isSessionRpc || response.statusCode >= 400 || response.statusCode === 0) {
        logDiag('http', { path: shortUrl, status: response.statusCode, ms, entry: currentEntry })
      }
      // ⚠️ **网络层失败不一定 reject**。微信在连接被重置 / 建连失败这类情形下会 resolve
      // 一个 statusCode 为 0 的响应（既没有 HTTP 状态，也不是 fail 回调）。在此之前这种
      // 响应既不进失败分支、不上报、不重试，也永远不会触发换入口——而它恰恰是「那一跳
      // 不通」最常见的样子。转成异常，让它和 reject 走同一条路（postgrest 最终给上层看到的
      // 仍是 `status: 0`，与今天一致）。
      if (response.statusCode === 0) {
        const zero = new Error('request:fail (statusCode=0)') as Error & { statusZero?: boolean }
        zero.statusZero = true
        throw zero
      }
      // 可重试的服务端瞬时故障：520（Cloudflare 报源站异常）与 503（PostgREST schema
      // cache 未加载）。**这两个码是从 postgrest 手里接过来的**——它原本在 db.retry
      // 下会重试它们，而我们关掉了 db.retry，不补上就是功能倒退。
      // 其余 5xx 不重试：那些多半是业务/数据问题，重试只是把同一个错误再犯一次。
      const transientHttp = response.statusCode === 520 || response.statusCode === 503
      if (
        transientHttp &&
        canRetry &&
        attempt < RETRY_MAX_ATTEMPTS &&
        Date.now() - totalStartedAtMs < RETRY_BUDGET_MS
      ) {
        await sleep(backoffMs(attempt))
        continue
      }
      if (response.statusCode >= 400) {
        // HTTP 层失败：5xx 算故障；4xx 降为 warn——那多半是鉴权/参数问题（如未登录查表返回
        // 401），跟断网不是一回事，混在同一等级会让真正的故障淹掉
        reportRequestFailure(
          'request_failed',
          url,
          String(method),
          `HTTP ${response.statusCode}`,
          response.statusCode >= 500 ? 'error' : 'warn',
          // 状态码同时进 message（指纹粒度）和字段（可聚合）。ms 是「卡了多久」的唯一来源：
          // 502 在 30s 后出现和 0.2s 后出现，指向完全不同的病因。
          { diag, ms, status: response.statusCode, attempts: attempt }
        )
      } else if (attempt > 1) {
        // 重试后成功也留一条（warn 级）。没有它，「弱网到底有多普遍」「这次改造有没有用」
        // 就永远看不见——库里只会有失败，而失败恰恰是重试想消掉的那部分。
        reportRequestFailure('request_retried', url, String(method), '重试后成功', 'warn', {
          diag,
          ms,
          status: response.statusCode,
          attempts: attempt,
        })
      }
      // 换过去的那个入口**把这次请求办成了** —— 这是唯一足以翻转偏好的证据。
      // 只凭「失败」翻转的话，设备真的没网时两个入口会来回弹（两边都失败）；
      // 而「另一个域名刚刚成功过一次」是伪造不来的。4xx/5xx 也算成功：那至少证明链路可达，
      // 与「拿到了响应就说明网是通的」同一条判据（见下面的 success hook）。
      if (switchedEntry) {
        const record = switchTo(currentEntry)
        if (record) {
          reportRequestFailure(
            'entry_switched',
            url,
            String(method),
            `入口 ${record.from} → ${record.to}`,
            'warn',
            { diag, ms, attempts: attempt, status: response.statusCode }
          )
        }
      }
      const responseData =
        typeof response.data === 'string' ||
        (typeof ArrayBuffer !== 'undefined' && response.data instanceof ArrayBuffer) ||
        (typeof Blob !== 'undefined' && response.data instanceof Blob)
          ? response.data
          : JSON.stringify(response.data)
      // 拿到了响应就说明网是通的（4xx/5xx 也算——那至少证明链路可达），
      // 顺带把积压的错误队列送出去。排除上报端点自身，否则 flush 成功会再触发 flush。
      // 位置在**最后一次尝试之后**：中途某次拿到 5xx 就白触发一轮 flush 是没意义的。
      if (!url.includes(ERROR_REPORT_PATH)) {
        try {
          requestSuccessHook?.()
        } catch {
          // 钩子绝不能反过来影响请求本身
        }
      }
      return createFetchResponse(response.statusCode, response.header, responseData)
    } catch (err) {
      // 微信的 Taro.request 失败时 reject 的是 `{ errMsg }` 对象、不是 Error 实例，
      // 不优先取 errMsg 会得到 "[object Object]"（实测踩过）。此处内联而非复用
      // error-report 的 describeError：supabase 是它的依赖，import 会成环。
      const errMsg =
        err instanceof Error
          ? err.message
          : ((err as { errMsg?: string } | null)?.errMsg ?? String(err))
      const ms = Date.now() - attemptStartedAtMs
      const statusZero = (err as { statusZero?: boolean } | null)?.statusZero === true
      logDiag('http_error', { path: shortUrl, ms, err: errMsg, entry: currentEntry })
      // 网络层失败：DNS 解析不了（ERR_NAME_NOT_RESOLVED）/ 连接超时 / 网络切换……
      // 这正是「点了没反应」的真身，也是服务端永远看不到的那一半。
      // ms 尤其关键：它把「卡了 55s 才失败」和「立刻失败」分开——前者是挂起，
      // 后者是链路不通，而用户看到的都是同一句文案；这里它还决定**要不要重试**。
      const withinBudget = Date.now() - totalStartedAtMs < RETRY_BUDGET_MS

      // 换入口**占用的是最后一次尝试**（所以同入口重试的上限要减一，总尝试次数不变）。
      // 它排在「同入口再试一次」之后：单次失败可能只是一次丢包，而换过去意味着用户
      // 回到跨境链路上——那正是这次改造要摆脱的东西，值得多要一次证据。
      //
      // ⚠️ 「另一个入口存在」必须并进这个判断：漏了它，没配反代时上限也会被削掉一次，
      // 单入口的行为就悄悄变了（守门用例抓过一次）。
      const alt = canRetry && !isStorageUrl && !switchedEntry ? otherEntry(currentEntry) : null
      const canFailover = alt !== null && withinBudget
      const sameEntryCap = canFailover ? RETRY_MAX_ATTEMPTS - 1 : RETRY_MAX_ATTEMPTS
      if (canRetry && ms < RETRY_SLOW_MS && withinBudget && attempt < sameEntryCap) {
        await sleep(backoffMs(attempt))
        continue
      }
      if (canFailover && alt) {
        switchedEntry = true
        currentEntry = alt
        requestUrl = rewriteTo(url, alt)
        // **不退避**：换的是域名，不是「等一会儿再试」。
        // 也**不看 RETRY_SLOW_MS**：那条规则防的是「在弱网上把请求数放大」，而这里
        // 改的是走哪条路，不是再撞一次同一堵墙——挂到超时（8 秒无响应）恰恰是
        // 「抽到坏落点」最典型的样子，它比快速失败更该换。代价由剩余预算封顶（见上）。
        continue
      }
      // 重试次数用完（或本来就不该重试）：**只在这里上报一次**。中途每次失败都报的话，
      // 一次请求会往库里写 3 条，把 5 分钟指纹窗口用满、掩盖掉真实的第二条错误。
      reportRequestFailure('request_failed', url, String(method), errMsg, 'error', {
        diag,
        ms,
        attempts: attempt,
        totalMs: Date.now() - totalStartedAtMs,
        // 微信对「超时」和「DNS 解析失败」给的是同一句 `request:fail`（都不带原因），
        // 事后判读分不出是「链路不通」还是「挂到超时」——而两者该做的事相反
        // （前者重试有意义，后者重试只会再等一个超时）。按耗时自标一个字段。
        // ⚠️ 阈值必须用**这一次实际用的**超时：换入口那次是压过的，拿原值比会误判。
        timedOut: ms >= attemptTimeoutMs - 500,
        // statusCode 为 0 的那一类（resolve 而非 reject）单独标出来：它与
        // `errRaw` 里能看出 DNS/TCP 细节的 reject 不是一回事，判读时要分开算
        statusZero,
        // 失败发生在哪个入口上——「反代挂了」和「直连抽到坏落点」的处置完全不同
        entry: currentEntry,
        // errRaw 留在最后：detail 超预算时按顺序截断（见 error-report 的 fitDetail），
        // 它最长，放前面会把上面的短字段挤掉
        errRaw: stringifyErr(err),
      })
      throw err
    }
  }
}

type TaroBody = string | ArrayBuffer | Blob | FormData | URLSearchParams

async function toTaroBody(body: BodyInit | null | undefined): Promise<TaroBody | undefined> {
  if (body === null || body === undefined) return undefined
  if (typeof body === 'string') return body
  if (body instanceof ArrayBuffer) return body
  // 微信 readFile 等接口可能返回 Uint8Array 等 ArrayBufferView，统一取其底层 ArrayBuffer，
  // 否则会被判为「不支持该请求体类型」
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body.arrayBuffer()
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return body.toString()
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) return body
  throw new Error('微信请求暂不支持该请求体类型')
}

function createFetchResponse(
  status: number,
  header: Record<string, string>,
  data: string | ArrayBuffer | Blob
): Response {
  if (typeof Response !== 'undefined') {
    return new Response(data, { status, headers: header })
  }
  const bytes = typeof data === 'string' ? encodeText(data) : data
  const text = async () => (typeof data === 'string' ? data : decodeBody(data))
  const getHeader = (name: string) =>
    Object.entries(header).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? null
  const blob = async () => {
    if (typeof Blob === 'undefined') throw new Error('当前环境不支持 Blob')
    return typeof data !== 'string' && isBlob(data) ? data : new Blob([bytes])
  }
  return {
    body: null,
    bodyUsed: false,
    headers: {
      get: getHeader,
      has: (name: string) => getHeader(name) !== null,
    } as Response['headers'],
    ok: status >= 200 && status < 300,
    redirected: false,
    status,
    statusText: '',
    type: 'basic',
    url: '',
    arrayBuffer: async () => (isBlob(bytes) ? bytes.arrayBuffer() : bytes),
    blob,
    clone: () => createFetchResponse(status, header, data),
    formData: async () => {
      if (typeof FormData === 'undefined') throw new Error('当前环境不支持 FormData')
      return new FormData()
    },
    json: async () => JSON.parse(await text()),
    text,
  } as Response
}

function encodeText(value: string): ArrayBuffer {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).buffer
  const encoded = unescape(encodeURIComponent(value))
  const bytes = new Uint8Array(encoded.length)
  for (let index = 0; index < encoded.length; index += 1) {
    bytes[index] = encoded.charCodeAt(index)
  }
  return bytes.buffer
}

function decodeBody(value: ArrayBuffer | Blob): string {
  if (!isArrayBuffer(value)) return '[二进制响应]'
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(value)
  const bytes = new Uint8Array(value)
  let encoded = ''
  for (const byte of bytes) encoded += `%${byte.toString(16).padStart(2, '0')}`
  try {
    return decodeURIComponent(encoded)
  } catch {
    return String.fromCharCode(...bytes)
  }
}

function isBlob(body: ArrayBuffer | Blob): body is Blob {
  return typeof Blob !== 'undefined' && body instanceof Blob
}

function isArrayBuffer(body: ArrayBuffer | Blob): body is ArrayBuffer {
  return typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer
}

/**
 * 占位 WebSocket transport：小程序 JSCore 无全局 WebSocket，realtime-js 在
 * createClient 时会立即检测并抛「Unknown JavaScript runtime without WebSocket
 * support」（app 启动即崩）。member 端不使用 realtime（全部挂载查询 + 手动重取），
 * 传入本占位类跳过检测；若未来接入 realtime，需改为基于 wx.connectSocket 的适配实现。
 * 占位类被实例化（即有人真的去 connect）时抛错——fail-loud，而非静默无反应。
 */
class UnsupportedWebSocketTransport {
  constructor() {
    throw new Error('小程序端未接入 Realtime（wx.connectSocket 适配未实现），请改用轮询或手动刷新')
  }
}

export const supabase: SupabaseClient<Database> = createClient<Database>(
  // 基址固定为**直连**，谁真正生效由 lib/supabase-entry 决定、在 taroFetch 出口处重写。
  // 不直接给它反代的理由见 supabase-entry 里 `directBase` 的注释（storage 的派生 URL
  // 绕过 taroFetch，基址一旦是反代，大文件就会从后门走回云函数）。
  directBase,
  supabaseAnonKey,
  {
    db: {
      // 关掉 postgrest-js 的内建重试。它默认是**开着**的（`builder.retry ?? true`），
      // 只对幂等方法（GET/HEAD/OPTIONS）在 520/503 与网络错误上生效、退避
      // min(1000·2ⁿ, 30000)、最多 3 次——也就是**今天一个失败的 GET 实际已经打了 4 次**。
      //
      // 关它的理由：重试要集中到 taroFetch 一处。散在两处的话，次数对不上、日志与指标
      // 解释不了，而且 postgrest 这条只覆盖 `/rest/v1` —— `/auth/v1`、`/functions/v1`、
      // `/storage/v1` 永远享受不到。taroFetch 是全部四条出口的唯一交汇点。
      //
      // ⚠️ **不要在这里加 `timeout`** —— 原因见 REQUEST_TIMEOUT_MS 的注释（AbortController
      // 在小程序里不存在，配上会让每个 PostgREST 请求静默失败）。
      retry: false,
    },
    auth: {
      detectSessionInUrl: false,
      storage,
    },
    global: {
      fetch: process.env.TARO_ENV === 'weapp' ? taroFetch : fetch,
    },
    // 仅 weapp 端注入（h5 构建期常量折叠为 undefined，走浏览器原生 WebSocket）
    realtime:
      process.env.TARO_ENV === 'weapp'
        ? {
            // realtime-js 期望 WebSocketLikeConstructor；占位类仅在 connect 时实例化并抛错，
            // 用宽松构造器签名满足类型（realtime-js 为传递依赖，无法 type-only 导入其类型）
            transport: UnsupportedWebSocketTransport as unknown as new (...args: any[]) => any,
          }
        : undefined,
  }
)
