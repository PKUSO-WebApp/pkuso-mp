/**
 * 云函数 `supabase-proxy`（微信云开发 / CloudBase）
 *
 * 三种模式，同一个函数、同一份代码：
 *
 *   1. **回显模式** `GET /__echo`  —— 把 event 原样吐回来。
 *      它的唯一用途是**让平台自己告诉我们契约**：HTTP 访问服务把请求交给云函数时，
 *      路径有没有带前缀、query 是原始串还是解析过的 map、头全不全、body 怎么编码。
 *      这些都没写在文档的确切位置，猜不如问。**部署后第一件事就是打它。**
 *
 *   2. **探针模式** `GET /__probe`（或定时触发） —— 测「机房 → Supabase」这一跳。
 *      与 ../probe/index.js 是同一套逻辑：四个目标 + 两个对照组 + 分层耗时 + cf-ray 落点。
 *      结果写回 client_error_logs（source='probe'）；写失败就重试，**表里的空洞本身就是失败记录**。
 *
 *   3. **反代模式** 其余所有路径 —— 转发到 Supabase 并原样返回。
 *
 * 部署方式：**微信开发者工具右键「上传并部署」**（这个函数不在任何 CI 里，文件头就是它的部署说明书）。
 * 同一份代码部署**两次**：`supabase-proxy`（上游 = 生产）与 `supabase-proxy-dev`（上游 = 开发），
 * 两者**必须字节相同**，差异只在控制台的环境变量。dev 那份由 `scripts/sync-cloudfunctions.mjs`
 * 生成、不入库 —— 所以改完这里要跑一次它再部署，否则 dev 侧会停在旧代码上。
 *
 *   node scripts/sync-cloudfunctions.mjs     # 生成 supabase-proxy-dev/（幂等）
 *
 * 环境变量：`SUPABASE_URL`（上游，缺省为生产）、`SUPABASE_ANON_KEY`、`BASE_PATH`（见下）、
 * `PROBE_TAG`、`MP_APPID`、三个超时。**没有「环境名」这一项** —— 认环境只看上游指向谁。
 *
 * ⚠️ 打「反代模式」的判据来自官方文档的**集成请求/集成响应**结构；其中 query 的重建方式
 *    与响应头是否被网关过滤两处**未经实测**，代码里用 `待 /__echo 确认` 标了出来。
 */

'use strict'

const https = require('https')
const dns = require('dns')
const { randomUUID } = require('crypto')

const UPSTREAM = (process.env.SUPABASE_URL || 'https://xkrszbmmdaorivkatvwh.supabase.co').replace(/\/+$/, '')
const UPSTREAM_HOST = new URL(UPSTREAM).hostname
const ANON_KEY = process.env.SUPABASE_ANON_KEY || ''
const PROBE_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 10000)
/**
 * 反代转发时的上游超时。
 *
 * **取宽（20 秒）是有意的：登录链路本来就慢。** `wechat-auth` 服务端实测常态 2.2–3.3 秒，
 * 冷启动那次 7.07 秒（同一请求 47 秒后重试只要 1.52 秒），经代理还要再加那一跳。
 *
 * ⚠️ **不要为了「让客户端能拿到 502 好去换直连」而把它压到客户端单次超时（8 秒）之下。**
 * 2026-10-03 试过 4 秒，是错的，理由是切断之后**无法补救**：代理断开上游连接时函数仍在跑，
 * 而 `code2session` 在头 1.5 秒内就把那个一次性 wx code 消费掉了 —— 客户端拿到 502 换直连、
 * 拿同一个已作废的 code 再问一次，只会得到「code 无效」。
 * 也就是说：**本来等 7 秒能登进去的，被切成了必失败。** 慢一点可以接受，登不上不可以。
 *
 * （分档超时——读切得早、登录保持宽——是讨论过的方向，但它只有与「客户端预算也按路径分开」
 * 一起做才有意义，未做；见该次改动的记录。别只改这一半。）
 */
const PROXY_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS || 20000)
const WRITE_TIMEOUT_MS = Number(process.env.WRITE_TIMEOUT_MS || 8000)
const WRITE_BACKOFF_MS = [1000, 3000]
const TAG = process.env.PROBE_TAG || 'cloudbase-v1'
/** 留空 = 不校验；填小程序 appid 则只接受 Referer 来自本小程序的请求（挡扫描器，挡不住有心人） */
const MP_APPID = process.env.MP_APPID || ''

/**
 * HTTP 访问服务里的**触发路径**（路由前缀）。
 *
 * 路由配 `/` 时留空。配 `/dev` 这类子路径时，`event.path` 带不带前缀**取决于网关**——
 * 实测只覆盖过路由是 `/` 的情形（见 toPathAndQuery 上方那一段），所以这里做成配置项。
 *
 * **填了也安全**：剥前缀要求路径真的以它开头，而 Supabase 没有 `/dev/*` 这类端点，
 * 所以「网关其实已经剥掉了」只会让这一步变成空操作，不会误剥。
 * 反过来（网关带前缀、这里却留空）会把 `/dev/rest/v1/x` 原样转给上游 → 404，
 * 是响亮的失败、不是静默查错数据。判据随时可查：打一次 `<前缀>/pkuso-echo`，
 * 回显**不剥前缀**，答案就在 event.path 里。
 */
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH || '')

function normalizeBasePath(value) {
  const trimmed = String(value).trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return trimmed.startsWith('/') ? trimmed : '/' + trimmed
}

function stripBasePath(path) {
  if (!BASE_PATH) return path
  if (path === BASE_PATH) return '/'
  if (path.indexOf(BASE_PATH + '/') === 0) return path.slice(BASE_PATH.length)
  return path
}

// ============================================================================
// 通用：一次原始 HTTP 请求，带分层耗时。失败也 resolve —— 失败本身就是数据。
// ============================================================================

function describe(err) {
  if (!err) return 'unknown'
  if (typeof err === 'string') return err
  const code = err.code || err.name || ''
  const msg = err.message || ''
  return (code ? code + ' ' : '') + msg
}

function rawRequest({ url, method = 'GET', headers = {}, body = null, timeoutMs = PROBE_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const out = {
      ok: false,
      status: null,
      err: null,
      ip: null,
      family: null,
      dns_ms: null,
      tcp_ms: null,
      tls_ms: null,
      ttfb_ms: null,
      total_ms: null,
      cf_colo: null,
      headers: null,
      bodyBuffer: null,
      /** 收到过任何响应字节吗？——决定「能不能安全重试」的关键 */
      gotResponse: false,
    }
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      out.total_ms = Date.now() - t0
      resolve(out)
    }

    let req
    try {
      req = https.request(url, {
        method,
        headers: { 'user-agent': 'pkuso-cloudbase-proxy/1', ...headers },
        // 每次新建连接：测的是「此刻能不能建起连接」。陈旧连接复用是客户端侧的病，不在这里测。
        agent: false,
        timeout: timeoutMs,
      })
    } catch (err) {
      out.err = 'construct: ' + describe(err)
      return finish()
    }

    req.on('socket', (socket) => {
      socket.on('lookup', (err, address, family) => {
        out.dns_ms = Date.now() - t0
        if (err) {
          out.err = out.err || 'lookup: ' + describe(err)
          return
        }
        out.ip = address
        out.family = family
      })
      socket.on('connect', () => {
        out.tcp_ms = Date.now() - t0
        out.ip = out.ip || socket.remoteAddress || null
        out.family = out.family || socket.remoteFamily || null
      })
      socket.on('secureConnect', () => {
        out.tls_ms = Date.now() - t0
      })
    })

    req.on('timeout', () => {
      out.err = out.err || 'socket timeout @' + timeoutMs + 'ms'
      req.destroy(new Error('ETIMEDOUT'))
    })

    req.on('error', (err) => {
      out.err = out.err || describe(err)
      finish()
    })

    req.on('response', (res) => {
      out.gotResponse = true
      out.ok = true
      out.status = res.statusCode
      out.ttfb_ms = Date.now() - t0
      out.headers = res.headers
      const ray = res.headers['cf-ray']
      if (ray) out.cf_colo = String(ray).split('-')[1] || null
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        out.bodyBuffer = Buffer.concat(chunks)
        finish()
      })
      res.on('error', (err) => {
        out.err = out.err || 'response: ' + describe(err)
        finish()
      })
    })

    if (body !== null && body !== undefined) req.write(body)
    req.end()
  })
}

/** A / AAAA / lookup 各自解析得出来什么（resolve4/6 走 c-ares，绕开系统解析器，可能不可用） */
async function dnsInfo(hostname) {
  const out = { a: null, aaaa: null, lookup: null, ms: null }
  const t0 = Date.now()
  try {
    out.a = await dns.promises.resolve4(hostname)
  } catch (err) {
    out.a = 'ERR:' + (err.code || err.message)
  }
  try {
    out.aaaa = await dns.promises.resolve6(hostname)
  } catch (err) {
    out.aaaa = 'ERR:' + (err.code || err.message)
  }
  if (typeof out.a === 'string' && typeof out.aaaa === 'string') {
    try {
      const all = await dns.promises.lookup(hostname, { all: true, verbatim: true })
      out.lookup = all.map((r) => r.address + '/' + (r.family === 6 ? 'v6' : 'v4'))
    } catch (err) {
      out.lookup = 'ERR:' + (err.code || err.message)
    }
  }
  out.ms = Date.now() - t0
  return out
}

// ============================================================================
// 写回 client_error_logs（anon 可调的 rpc）。写失败就重试；仍失败 = 表里留一个空洞。
// ============================================================================

async function writeRow(row) {
  const url = UPSTREAM + '/rest/v1/rpc/log_client_errors'
  const payload = JSON.stringify({ rows: [row] })
  const headers = {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    apikey: ANON_KEY,
    Authorization: 'Bearer ' + ANON_KEY,
  }
  let last = null
  for (let attempt = 1; attempt <= 1 + WRITE_BACKOFF_MS.length; attempt += 1) {
    last = await rawRequest({ url, method: 'POST', headers, body: payload, timeoutMs: WRITE_TIMEOUT_MS })
    if (last.ok && last.status >= 200 && last.status < 300) {
      return { ok: true, status: last.status, attempts: attempt, ms: last.total_ms }
    }
    const wait = WRITE_BACKOFF_MS[attempt - 1]
    if (wait) await new Promise((r) => setTimeout(r, wait))
  }
  return { ok: false, status: last && last.status, err: last && last.err, attempts: 1 + WRITE_BACKOFF_MS.length }
}

async function report(event, message, detail, level = 'error') {
  const row = {
    client_id: randomUUID(), // 该列是补送幂等键，不是设备号
    created_at: new Date().toISOString(),
    level,
    source: 'proxy',
    event,
    message: String(message).slice(0, 400),
    detail: detail || {},
    app_version: TAG,
    platform: 'cloudbase',
    page: null,
  }
  try {
    console.log('[cel] ' + JSON.stringify(row))
  } catch {
    /* 日志本身绝不能影响请求 */
  }
  return writeRow(row)
}

// ============================================================================
// 模式 1：探针
// ============================================================================

/**
 * 探测目标。
 *
 * ⚠️ **两个对照组必须用小体积目标**：云开发的「云函数外网出流量」是按量套餐里最容易撞顶的一项
 * （基础套餐 2–4 GB/月）。这个探针每分钟跑一次 = 4.3 万次/月，**目标页面的体积直接乘以 4.3 万**：
 *   - 拿 `https://cloud.tencent.com/` 首页当对照组 ⇒ 首页几十 KB × 4.3 万 ≈ **3.6 GB/月**，一项吃掉全年额度；
 *   - 换成 `robots.txt` + **HEAD**（只取响应头、不下载 body）⇒ **≈0.02 GB/月**，差近 200 倍。
 * 对照组的作用只是「证明函数自己有网」，**不需要内容**，所以 HEAD 完全够。
 *
 * `cf-ray` 落在**响应头**里，所以 HEAD 一样能拿到落点 colo。
 */
function buildTargets() {
  return [
    // 走 GoTrue：响应体最小 ⇒ 最干净的「路通不通」。
    // apikey 必须带：Kong 在前面拦着，不带它拿到的永远是 401「No API key found」——
    // 那条虽然也能证明「路通」，但会把每一次探测都记成非 200，长期看是一堆噪音。
    { name: 'supabase_auth', url: UPSTREAM + '/auth/v1/health', headers: { apikey: ANON_KEY }, method: 'GET' },
    // 走 PostgREST：与真实业务同一条腿（带 apikey）。401/404 也算「路是通的」
    {
      name: 'supabase_rest',
      url: UPSTREAM + '/rest/v1/profiles_roster?select=id&limit=1',
      headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY },
      method: 'GET',
    },
    // 对照 1：境外但非 Supabase —— 把「CF 整体不通」与「这个域名不通」分开（几百字节，GET 无妨）
    { name: 'control_cf', url: 'https://www.cloudflare.com/cdn-cgi/trace', headers: {}, method: 'GET' },
    // 对照 2：境内 —— 证明「函数自己有网」。它要是红了，整批数据作废。
    // 小文件 + HEAD：体积从几十 KB 降到几百字节（见上方注释，这不是省小钱）
    { name: 'control_cn', url: 'https://cloud.tencent.com/robots.txt', headers: {}, method: 'HEAD' },
  ]
}

async function runProbe() {
  const startedAt = new Date()
  const dnsResults = await dnsInfo(UPSTREAM_HOST)

  const probes = {}
  for (const target of buildTargets()) {
    const r = await rawRequest({
      url: target.url,
      method: target.method || 'GET',
      headers: target.headers,
    })
    probes[target.name] = {
      ok: r.ok,
      status: r.status,
      err: r.err,
      ip: r.ip,
      family: r.family,
      dns_ms: r.dns_ms,
      tcp_ms: r.tcp_ms,
      tls_ms: r.tls_ms,
      ttfb_ms: r.ttfb_ms,
      total_ms: r.total_ms,
      cf_colo: r.cf_colo,
      body_head: r.bodyBuffer ? r.bodyBuffer.toString('utf8').slice(0, 120) : null,
    }
  }

  const write = await writeRow({
    client_id: randomUUID(),
    created_at: startedAt.toISOString(),
    level: 'info',
    source: 'probe',
    event: 'net_probe',
    message: 'net_probe ' + TAG,
    detail: {
      tag: TAG,
      node: process.version,
      region: process.env.TENCENTCLOUD_REGION || process.env.SCF_REGION || null,
      env: process.env.TCB_ENV || null,
      supabase_host: UPSTREAM_HOST,
      dns: dnsResults,
      probes,
    },
    app_version: TAG,
    platform: 'cloudbase',
    page: null,
  })

  return {
    ok: true,
    at: startedAt.toISOString(),
    dns: dnsResults,
    summary: Object.fromEntries(
      Object.entries(probes).map(([name, p]) => [
        name,
        { ok: p.ok, status: p.status, colo: p.cf_colo, ip: p.ip, v: p.family, ttfb_ms: p.ttfb_ms, err: p.err },
      ])
    ),
    write,
  }
}

// ============================================================================
// 模式 2：回显 —— 让平台告诉我们契约
// ============================================================================

/**
 * 回显：**只挑我们做决定需要的字段**，不是 dump 整个 event。
 *
 * 第一版是「原样 dump，超长就截断」，结果实测被 `x-cloudbase-context`（1.5 KB 的 base64）
 * 挤爆，`path` / `queryStringParameters` 恰恰落在被截掉的那一段里——**最需要的字段最先丢**。
 * 所以改成精选视图：这几个字段永远是完整的，噪音头只留名字。
 */
const HEADERS_OF_INTEREST = [
  'apikey',
  'authorization',
  'prefer',
  'range',
  'content-type',
  'content-length',
  'accept-encoding',
  'x-pkuso-diag',
  'referer',
  'origin',
  'user-agent',
]

function pickOfInterest(source) {
  const out = {}
  for (const [k, v] of Object.entries(source || {})) {
    if (HEADERS_OF_INTEREST.includes(String(k).toLowerCase())) out[String(k).toLowerCase()] = v
  }
  return out
}

function echoResponse(event, context) {
  const bodyIsString = typeof event.body === 'string'
  return asHttpJson({
    ok: true,
    note: '把这段 JSON 原样发回给我，我按它定反代的解析方式',
    env: {
      TCB_ENV: process.env.TCB_ENV || null,
      TENCENTCLOUD_REGION: process.env.TENCENTCLOUD_REGION || null,
      node: process.version,
      MP_APPID: MP_APPID || null,
    },
    // ↓ 这几行就是全部目的地：路径形态、query 重建、body 编码、头是否齐
    path: event.path === undefined ? null : event.path,
    rawPath: event.rawPath === undefined ? null : event.rawPath,
    httpMethod: event.httpMethod === undefined ? null : event.httpMethod,
    isBase64Encoded: event.isBase64Encoded === undefined ? null : event.isBase64Encoded,
    bodyIsString,
    bodyLength: bodyIsString ? event.body.length : null,
    bodyHead: bodyIsString ? event.body.slice(0, 200) : null,
    queryStringParameters: event.queryStringParameters === undefined ? null : event.queryStringParameters,
    multiValueQueryStringParameters:
      event.multiValueQueryStringParameters === undefined ? null : event.multiValueQueryStringParameters,
    queryString: event.queryString ?? event.rawQueryString ?? null,
    eventKeys: Object.keys(event).sort(),
    headerNames: Object.keys(event.headers || {}).sort(),
    headersOfInterest: pickOfInterest(event.headers),
    multiValueHeadersOfInterest: pickOfInterest(event.multiValueHeaders),
    requestContextKeys: Object.keys(event.requestContext || {}).sort(),
    contextKeys: context ? Object.keys(context) : null,
  })
}

// ============================================================================
// 模式 3：反代
// ============================================================================

/**
 * 网关自己注入的头，**一律不进上游**。
 *
 * 头前缀与精确名两份，是因为它们形态不同（前缀类的会带各种后缀）。
 * 实测看到的注入头（`/pkuso-echo` 一次就全露出来了）：
 *   `x-cloudbase-context`（⚠️ **内含 serviceAccessToken —— 一个 JWT**）、`x-cloudbase-request-id`、
 *   `x-cloudbase-trace`、`x-administrator`、`x-authmethod`、`x-userid`、`x-usertype`、
 *   `x-envoy-external-address`、`x-real-ip`、`x-forwarded-for`、`traceparent`、`x-request-id`。
 * 把 `x-cloudbase-context` 透传出去 = 把平台的访问令牌交给 Supabase，所以这条不是洁癖。
 */
const GATEWAY_HEADER_PREFIXES = ['x-wx-', 'x-cloudbase-', 'x-scf-', 'x-tencent-scf-', 'x-envoy-']
const GATEWAY_HEADER_EXACT = new Set([
  'x-real-ip',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-forwarded-host',
  'traceparent',
  'tracestate',
  'x-request-id',
  'x-administrator',
  'x-authmethod',
  'x-userid',
  'x-usertype',
])

function isGatewayHeader(name) {
  if (GATEWAY_HEADER_EXACT.has(name)) return true
  return GATEWAY_HEADER_PREFIXES.some((p) => name.startsWith(p))
}

/** 逐跳头（hop-by-hop）不能透传，必须由本跳重算 */
const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
])

/**
 * 哪些请求可以在**上游连接层失败**时安全重试。
 * 与 mp 端 `taroFetch` 的策略**刻意保持一致**（同一份白名单，同一个理由）：
 * 只重试幂等方法 + 三个只读 RPC。多试一次幂等请求的代价是几十毫秒；
 * 多试一次 `/auth/v1/token` 或插入的代价是**用户被登出 / 重复请假单**。
 */
const RETRYABLE_READ_POSTS = [
  '/rest/v1/rpc/check_data_versions',
  '/rest/v1/rpc/get_my_session',
  '/rest/v1/rpc/get_my_profile_entry',
]

function isRetryable(method, path) {
  const m = String(method || '').toUpperCase()
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true
  if (m !== 'POST') return false
  return RETRYABLE_READ_POSTS.includes(String(path || '').split('?')[0])
}

/**
 * 把**对象形态**的 query（值可能是数组）逐项 append 成 query 串。
 *
 * ⚠️ **必须逐项 append**。值是数组时若整只塞进去，`["1","2"]` 会被拼成 `a=1%2C2`
 * ——一个参数一个值，PostgREST 收到的查询就完全是另一回事了。
 * 而 PostgREST 的 `in.(a,b)`、`or=(...)` 这类恰恰**依赖参数值里的逗号**，
 * 拼错不会报错，只会静默查出不同的数据。
 */
function rebuildQueryFromMap(map) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(map)) {
    if (Array.isArray(v)) for (const item of v) params.append(k, item)
    else params.append(k, v)
  }
  return params.toString()
}

/**
 * 把 event 还原成「路径 + query 串」。
 *
 * 两种网关的 event 形状**不一样，这里是双形态兼容**（两边都经 `/pkuso-echo` 实测）：
 *   - 微信云开发 HTTP 网关（2026-09-30，ap-shanghai）：`path` 完整不带前缀、`rawPath` null；
 *     `queryString` = null ⇒ query 在 `queryStringParameters`；`isBase64Encoded` = false
 *   - 腾讯云 SCF 函数 URL（2026-10-04）：event 只有 `{body, headers, httpMethod, path, queryString}`
 *     五个键；`queryStringParameters` = null，**query 在 `queryString` 且是对象**（值可能是数组）
 *   - 两种 `path` 里都不带 query；Web 函数适配层（`scf-web/app.js`）把原始 `req.url`
 *     整个塞进 `path`，所以下面的 `path?query` 拆分就是那条路的唯一解析
 */
function toPathAndQuery(event) {
  // 剥掉路由前缀（BASE_PATH 为空时是空操作）。转发给上游的必须是**上游认识的路径**，
  // 而 `/dev` 只是网关那一段的入口，Supabase 那边没有它。
  let path = stripBasePath(event.path || event.rawPath || '/')
  let query = ''

  const qi = path.indexOf('?')
  if (qi >= 0) {
    query = path.slice(qi + 1)
    path = path.slice(0, qi)
  }

  if (!query && event.multiValueQueryStringParameters) {
    query = rebuildQueryFromMap(event.multiValueQueryStringParameters)
  }

  if (!query && event.queryStringParameters && Object.keys(event.queryStringParameters).length) {
    query = rebuildQueryFromMap(event.queryStringParameters)
  } else if (!query && event.queryString) {
    query =
      typeof event.queryString === 'string'
        ? event.queryString
        : Object.keys(event.queryString).length
          ? rebuildQueryFromMap(event.queryString)
          : ''
  }

  return { path, query }
}

async function runProxy(event) {
  const { path, query } = toPathAndQuery(event)
  const method = String(event.httpMethod || event.method || 'GET').toUpperCase()
  const target = UPSTREAM + path + (query ? '?' + query : '')

  let bodyBuffer = null
  if (event.body) {
    bodyBuffer = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body, 'utf8')
  }

  const headers = {}
  for (const [k, v] of Object.entries(event.headers || {})) {
    const lower = String(k).toLowerCase()
    if (HOP_BY_HOP.has(lower)) continue
    if (isGatewayHeader(lower)) continue
    headers[lower] = v
  }
  // 强制不压缩：我们原样搬运 body，压缩流会让「返回集成响应」变复杂且没有收益
  headers['accept-encoding'] = 'identity'
  if (!headers.apikey && ANON_KEY) headers.apikey = ANON_KEY

  const startedAt = Date.now()
  const retries = []
  let res = null
  const maxAttempts = isRetryable(method, path) ? 2 : 1

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    res = await rawRequest({
      url: target,
      method,
      headers,
      body: bodyBuffer,
      timeoutMs: PROXY_TIMEOUT_MS,
    })
    // 拿到过响应字节就绝不重试 —— 那时重试可能把已经执行过的写操作再执行一遍
    if (res.gotResponse) break
    if (attempt < maxAttempts) {
      retries.push({ attempt, err: res.err, ms: res.total_ms })
      await new Promise((r) => setTimeout(r, 150))
    }
  }

  const diag = {
    path,
    method,
    attempts: retries.length + 1,
    upstream_ms: res ? res.total_ms : null,
    dns_ms: res ? res.dns_ms : null,
    tcp_ms: res ? res.tcp_ms : null,
    tls_ms: res ? res.tls_ms : null,
    ttfb_ms: res ? res.ttfb_ms : null,
    cf_colo: res ? res.cf_colo : null,
    ip: res ? res.ip : null,
    v: res ? res.family : null,
    err: res ? res.err : null,
    total_ms: Date.now() - startedAt,
  }

  if (!res || !res.gotResponse) {
    // 连接层失败：这是**唯一值得报警**的一类 —— 请求根本没到 Supabase
    await report('proxy_failed', `${method} ${path} 上游连接失败: ${res ? res.err : 'no result'}`, diag)
    return {
      statusCode: 502,
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-pkuso-proxy': 'upstream-failed' },
      body: JSON.stringify({
        error: 'proxy_upstream_failed',
        detail: res ? res.err : null,
        path,
      }),
    }
  }

  const outHeaders = { 'x-pkuso-proxy': 'hit', 'x-pkuso-upstream-ms': String(diag.upstream_ms) }
  for (const [k, v] of Object.entries(res.headers || {})) {
    const lower = k.toLowerCase()
    if (HOP_BY_HOP.has(lower)) continue
    if (lower === 'content-encoding') continue // 已强制 identity
    if (v === undefined) continue
    outHeaders[lower] = Array.isArray(v) ? v.join(', ') : v
  }

  // **只在真的需要时才 base64**。
  // 反代的 99% 是 JSON 文本，如果一律走 base64，就整个方案都押在「网关认不认 isBase64Encoded」
  // 这一条上——而那是文档里的一句话，没实测过。押错的后果是客户端收到一堆乱码，
  // 且现象像「Supabase 返回了坏数据」，排查方向会跑偏。
  // 按内容自适应：是合法 UTF-8 就原样给文本，否则才退到 base64。
  const buf = res.bodyBuffer || Buffer.alloc(0)
  const asText = isProbablyText(buf)
  return {
    statusCode: res.status,
    headers: outHeaders,
    body: asText ? buf.toString('utf8') : buf.toString('base64'),
    isBase64Encoded: !asText,
  }
}

/** 这段字节是不是合法 UTF-8（能当文本原样返回）。空 body（HEAD、204）也算文本。 */
function isProbablyText(buf) {
  if (!buf || buf.length === 0) return true
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf)
    return true
  } catch {
    return false
  }
}

// ============================================================================
// 入口
// ============================================================================

/**
 * 把普通对象包成**集成响应**。
 *
 * 定时触发那条路上，返回裸对象就够了（没人消费）；但走 HTTP 时不行——
 * 云接入对「返回 Object」的转换规则没有明确写死（可能会被包一层），
 * 而这两个端点（`/pkuso-probe`、`/pkuso-echo`）的**全部价值就是让 body 可读**。
 * 所以显式给 statusCode + content-type + 字符串 body，别赌转换规则。
 */
function asHttpJson(obj) {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(obj, null, 2),
  }
}

function refererAllowed(event) {
  if (!MP_APPID) return true
  const ref = String((event.headers && (event.headers.referer || event.headers.Referer)) || '')
  return ref.indexOf('https://servicewechat.com/' + MP_APPID + '/') === 0
}

exports.main = async (event, context) => {
  const rawPath = event && (event.path || event.rawPath) ? String(event.path || event.rawPath) : ''
  const httpMethod = event && (event.httpMethod || event.method)
  // 分发也走剥前缀：否则配了 `/dev` 路由时，`/dev/pkuso-echo` 会认不出来而落到反代分支
  const pathOnly = stripBasePath(rawPath.split('?')[0])

  // 无 HTTP 方法 = 定时触发器 → 探针
  if (!httpMethod) return runProbe()

  // 两个前缀都收：`__` 开头有可能撞上网关的**系统保留前缀**（官方列了 `/__auth`），
  // 而保留前缀是在路由之前就拦掉的——那种情况我们连函数都进不来，只能换个不带下划线的名字试。
  // 两个都认，就不用猜是哪一种。
  //
  // ⚠️ 这两个端点**必须排在 Referer 校验之前**：它们的全部意义就是「让人从浏览器排查」，
  // 挡掉浏览器等于把唯一的排查入口关了（实测踩过：配好路由后从浏览器打，拿到的是自己发的 403，
  // 看起来像「网关拒绝」，其实链路早就通了）。
  if (pathOnly === '/pkuso-echo' || pathOnly === '/__echo') return echoResponse(event, context)
  if (pathOnly === '/pkuso-probe' || pathOnly === '/__probe') return asHttpJson(await runProbe())

  if (!refererAllowed(event)) {
    return {
      statusCode: 403,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'forbidden' }),
    }
  }

  try {
    return await runProxy(event)
  } catch (err) {
    await report('proxy_crashed', 'proxy 未预期异常: ' + describe(err), { path: pathOnly, method: httpMethod })
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'proxy_crashed', detail: describe(err) }),
    }
  }
}

/**
 * 仅供本地断言用的内部钩子。
 *
 * 存在的理由很具体：`toPathAndQuery` 的数组处理**错了不会报错，只会查出不同的数据**——
 * 只有直接断言它的输出才拦得住，而云上没有别的入口能看到重建结果。
 * 导出它不影响云函数运行（多余的导出没人读）。
 */
exports.__internals = { toPathAndQuery, isRetryable, isGatewayHeader, isProbablyText, stripBasePath }
