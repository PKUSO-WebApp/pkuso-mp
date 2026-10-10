import { supabase } from '@/lib/supabase'

/**
 * 调 Edge Function `compose-annotated-pdf`：把**当前登录用户**对这份谱的批注烧进 PDF，
 * 返回一个短时有效的签名 URL（服务端写的是 1 小时）。
 *
 * 服务端产出的桶是**私有**的，所以只能拿签名 URL；它落在项目自己的域名上，而 storage
 * 在 mp 里恒走直连（见 lib/supabase-entry.ts 的分工）⇒ **不经过反代**，
 * 反代那条约 4.5MB 的响应上限在这条路上不适用。
 *
 * ⚠️ `functions.invoke` **不抛错**：失败时 `error` 有值而 `data` 为 null，HTTP 非 2xx
 * 也一样。本仓栽过「invoke 吞错」，所以这里**两个都查**：只查 `error` 会把「非 2xx 但
 * error 为空」的形态放过去，只查 `data` 会把失败读成一个空对象——两者都会静默地变成
 * 「下载了一个空文件」。
 */

export type ComposedPdf = {
  /** 签名 URL（服务端给 1 小时） */
  url: string
  /** 产物字节数：给下载侧当**分片下载**的依据（见 lib/ranged-download） */
  bytes: number
  annotatedPages: number
  drawnStrokes: number
}

/** 服务端返回的业务错误码（`{ error: "..." }`），用来把可预期的那几种讲成人话 */
export type AnnotatedPdfErrorCode = 'no annotations' | 'file too large' | 'too many strokes' | 'unknown'

export class AnnotatedPdfError extends Error {
  code: AnnotatedPdfErrorCode
  constructor(code: AnnotatedPdfErrorCode, message: string) {
    super(message)
    this.name = 'AnnotatedPdfError'
    this.code = code
  }
}

type InvokeFn = (
  name: string,
  opts: { body: Record<string, unknown> }
) => Promise<{ data: unknown; error: unknown }>

/**
 * ⚠️ 默认实现**只在这里**碰 supabase：这个模块要能被单测直接加载
 * （supabase 在缺 env 时**导入即抛**，而 compose 的用例只想验响应形状的判定）。
 */
const defaultInvoke: InvokeFn = (name, opts) =>
  supabase.functions.invoke(name, opts) as unknown as ReturnType<InvokeFn>

/** 从 invoke 的 error 里挖出服务端那句话：`FunctionsHttpError` 把响应体挂在 `context` 上 */
async function serverMessage(error: unknown): Promise<string> {
  const e = error as { message?: string; context?: { json?: () => Promise<unknown> } }
  const base = typeof e?.message === 'string' && e.message ? e.message : String(error)
  try {
    const body = (await e?.context?.json?.()) as { error?: unknown } | undefined
    const detail = typeof body?.error === 'string' ? body.error : ''
    return detail ? `${base}: ${detail}` : base
  } catch {
    // 响应体不是 JSON / 已经被读过：拿基础那句话就够
    return base
  }
}

const KNOWN: AnnotatedPdfErrorCode[] = ['no annotations', 'file too large', 'too many strokes']

/** 服务端那句 `error` 里有没有我们认识的那几种（它可能被拼在冒号后面） */
function codeOf(message: string): AnnotatedPdfErrorCode {
  return KNOWN.find((c) => message.includes(c)) ?? 'unknown'
}

export async function composeAnnotatedPdf(
  fileId: string,
  invoke: InvokeFn = defaultInvoke
): Promise<ComposedPdf> {
  const { data, error } = await invoke('compose-annotated-pdf', { body: { file_id: fileId } })
  if (error) {
    const message = await serverMessage(error)
    throw new AnnotatedPdfError(codeOf(message), message)
  }
  const body = data as Partial<ComposedPdf> | null
  const url = typeof body?.url === 'string' ? body.url : ''
  // 没有 url 就是失败，哪怕 error 是空的——这条是「静默下到空文件」的唯一闸
  if (!url) throw new AnnotatedPdfError('unknown', 'compose-annotated-pdf: 响应里没有 url')
  return {
    url,
    bytes: typeof body?.bytes === 'number' ? body.bytes : 0,
    annotatedPages: typeof body?.annotatedPages === 'number' ? body.annotatedPages : 0,
    drawnStrokes: typeof body?.drawnStrokes === 'number' ? body.drawnStrokes : 0,
  }
}
