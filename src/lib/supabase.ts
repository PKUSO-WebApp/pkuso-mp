// 必须为首个 import：小程序 JSCore 无全局 Headers，supabase-js 模块初始化
// 会裸引用它导致启动即崩（ReferenceError: Headers is not defined），
// 此副作用 import 按声明顺序先于 @supabase/supabase-js 求值安装 polyfill
// （用 @/ 别名而非相对路径：import/first 规则要求绝对导入在前，别名不算相对）
import '@/lib/weapp-polyfills'
import Taro from '@tarojs/taro'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { logDiag } from './session-diag'

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

function reportRequestFailure(
  url: string,
  method: string,
  message: string,
  level: 'error' | 'warn'
): void {
  if (!requestFailureReporter) return
  if (url.includes(ERROR_REPORT_PATH)) return
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0].slice(0, 120)
  try {
    requestFailureReporter({
      event: 'request_failed',
      level,
      // message 里带上路径：指纹是「event + message 前缀」，于是不同端点的失败各算一条，
      // 而同一端点的重复失败仍被去重挡掉——这正是我们想要的粒度
      message: `${message} @ ${path}`,
      detail: { urlPath: path, method },
    })
  } catch {
    // 上报绝不能反过来影响请求本身
  }
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
  const body = await toTaroBody(init.body)
  // 会话诊断：auth 端点 / 单会话 RPC / 失败请求必记（低噪过滤），定位登录丢失附近的网络事件
  const startedAtMs = Date.now()
  const shortUrl = url.replace(/^https?:\/\/[^/]+/, '').slice(0, 160)
  const isAuthUrl = url.includes('/auth/v1/')
  const isSessionRpc = url.includes('touch_session') || url.includes('get_my_session')
  try {
    const response = await Taro.request({
      url,
      method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      header: headers,
      data: body,
      responseType: 'arraybuffer',
    })
    if (isAuthUrl || isSessionRpc || response.statusCode >= 400) {
      logDiag('http', { path: shortUrl, status: response.statusCode, ms: Date.now() - startedAtMs })
    }
    // HTTP 层失败：5xx 算故障；4xx 降为 warn——那多半是鉴权/参数问题（如未登录查表返回
    // 401），跟断网不是一回事，混在同一等级会让真正的故障淹掉
    if (response.statusCode >= 500) {
      reportRequestFailure(url, String(method), `HTTP ${response.statusCode}`, 'error')
    } else if (response.statusCode >= 400) {
      reportRequestFailure(url, String(method), `HTTP ${response.statusCode}`, 'warn')
    }
    const responseData =
      typeof response.data === 'string' ||
      (typeof ArrayBuffer !== 'undefined' && response.data instanceof ArrayBuffer) ||
      (typeof Blob !== 'undefined' && response.data instanceof Blob)
        ? response.data
        : JSON.stringify(response.data)
    return createFetchResponse(response.statusCode, response.header, responseData)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logDiag('http_error', { path: shortUrl, ms: Date.now() - startedAtMs, err: errMsg })
    // 网络层失败：DNS 解析不了（ERR_NAME_NOT_RESOLVED）/ 连接超时 / 网络切换……
    // 这正是「点了没反应」的真身，也是服务端永远看不到的那一半
    reportRequestFailure(url, String(method), errMsg, 'error')
    throw err
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
  supabaseUrl,
  supabaseAnonKey,
  {
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
