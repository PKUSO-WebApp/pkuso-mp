// 会话诊断日志：环形缓冲 + 追加写入用户文件区 session-diag.log，
// 用于定位「登录状态突然丢失」。设计约束：
// - 纯模块：不 import Taro（dataSync 等 hook 链会引入本模块，单测环境无 Taro）
//   ——文件写入能力由 app 层经 setSessionDiagFileSink 注入
// - 绝不影响业务流程：所有 IO 全部 try/catch 吞错；无 sink 时仅 console 镜像
// - 低噪：HTTP 只记 auth 端点 / 关键 RPC / >=400；其余靠 60s 心跳状态行兜底

const MAX_BUFFER = 500

// 埋点总开关：TARO_APP_SESSION_DIAG=1/true/on 时启用（在 .env.development / .env.production 配置）。
// 关闭时 logDiag 为空操作、心跳不启动——零开销。
const ENABLED = /^(1|true|on)$/i.test(String(process.env.TARO_APP_SESSION_DIAG ?? ''))

const buffer: string[] = []
let started = false
let statusProvider: (() => Record<string, unknown>) | null = null

function now(): string {
  return new Date().toISOString()
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '"[unserializable]"'
  }
}

function filePath(): string | null {
  try {
    const w = (globalThis as { wx?: { env?: { USER_DATA_PATH?: string } } }).wx
    const root = w?.env?.USER_DATA_PATH
    return root ? `${root}/session-diag.log` : null
  } catch {
    return null
  }
}

// 文件落盘槽：由 app 层注入（weapp 才有 FS）；未注入时仅 console
let fileSink: ((chunk: string) => void) | null = null
export function setSessionDiagFileSink(fn: (chunk: string) => void): void {
  fileSink = fn
}

/** 诊断日志唯一入口：console 即时镜像 + 缓冲后追加落盘（未启用开关时空操作） */
export function logDiag(event: string, detail?: Record<string, unknown>): void {
  if (!ENABLED) return
  const line = `${Date.now()} ${now()} [${event}]${detail ? ' ' + safeJson(detail) : ''}`
  // eslint-disable-next-line no-console
  console.log('[session-diag]', line)
  buffer.push(line)
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER)
  flush()
}

/** 把缓冲刷入文件；重入守卫：sink 内部再产生的日志只入缓冲、随下次事件落盘 */
let flushing = false
function flush(): void {
  if (flushing || buffer.length === 0) return
  const chunk = buffer.splice(0, buffer.length).join('\n') + '\n'
  flushing = true
  try {
    fileSink?.(chunk)
  } catch {
    /* sink 内部已自兜底 */
  } finally {
    flushing = false
  }
}

/** 注册心跳状态提供者（由 UserProvider 注入最新会话快照） */
export function setSessionStatusProvider(fn: () => Record<string, unknown>): void {
  statusProvider = fn
}

/** 幂等启动：60s 心跳（flush + 当前登录状态行）；未启用开关时空操作 */
export function startSessionDiag(): void {
  if (started || !ENABLED) return
  started = true
  logDiag('diag_start')
  setInterval(() => {
    flush()
    const status = statusProvider?.()
    if (status) logDiag('hb', status)
  }, 60_000)
}

/** 供排查工具读取的日志路径（可能为 null：非 weapp 环境） */
export function getSessionDiagFilePath(): string | null {
  return filePath()
}
