import Taro from '@tarojs/taro'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { activeEntry, baseFor, hasProxy, rewriteTo, type EntryName } from './supabase-entry'

/**
 * Storage 对象的上传/删除不能走 supabase-js 的默认 fetch：它的基址固定为直连，
 * 而 `taroFetch` 把 storage 当成「恒走直连」。上传是这里唯一需要 proxy-first 的
 * 写入路径，所以单独用 `Taro.request` 发原始字节，两条入口显式换腿。
 *
 * 为什么不是改 `taroFetch`：那条路是 storage-js 的通用出口（upload/remove/list/
 * createSignedUrl 都走它），改它会把删除、签名 URL 生成等控制面请求也一起改掉；
 * 而这里的范围只有「本地临时文件 → 公开/私有桶」。
 */

/** 反代那条腿该快；小图上传慢到 15 秒就是不通，换直连 */
export const PROXY_UPLOAD_TIMEOUT_MS = 15000
/** 直连那条腿沿用 storage 的平台默认量级（与 taroFetch 的 STORAGE_TIMEOUT_MS 一致） */
export const DIRECT_UPLOAD_TIMEOUT_MS = 60000

export type StorageUploadAttempt = {
  entry: EntryName
  url: string
  timeoutMs: number
}

export type StorageUploadResult =
  | { ok: true; entry: EntryName; attempts: number }
  | { ok: false; message: string; entry: EntryName; attempts: number; status: number }

function encodeStoragePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

/** 对象 URL（直连或反代）。只拼 `/storage/v1/object/<bucket>/<path>`，不碰 query。 */
export function storageObjectUrl(bucket: string, path: string, entry: EntryName): string {
  return `${baseFor(entry)}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeStoragePath(path)}`
}

/**
 * 上传要试的腿：当前入口优先，另一个兜底。
 *
 * 没配反代时只返回直连；反代基址与直连相同时（配置缺失）也不会返回重复腿。
 */
export function storageUploadAttempts(bucket: string, path: string): StorageUploadAttempt[] {
  const direct: StorageUploadAttempt = {
    entry: 'direct',
    url: storageObjectUrl(bucket, path, 'direct'),
    timeoutMs: DIRECT_UPLOAD_TIMEOUT_MS,
  }
  if (!hasProxy) return [direct]
  const proxyUrl = rewriteTo(direct.url, 'proxy')
  if (proxyUrl === direct.url) return [direct]
  const proxy: StorageUploadAttempt = {
    entry: 'proxy',
    url: proxyUrl,
    timeoutMs: PROXY_UPLOAD_TIMEOUT_MS,
  }
  return activeEntry() === 'proxy' ? [proxy, direct] : [direct, proxy]
}

/** 与 `newIdempotencyKey` 配套：同一份表单的重试复用同一个 key，换一份表单就换 key。 */
export function newIdempotencyKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function fnv1a(bytes: Uint8Array, seed: number): number {
  let hash = seed >>> 0
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index]
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * 文件内容指纹（两个不同种子的 FNV-1a，拼成 16 位十六进制）。
 *
 * 不用 `crypto.subtle`：小程序 JSCore 没有它；而这里的目的只是「同一次重试拿到同一个
 * 路径」，不是密码学去重。
 */
export function hashBytes(body: ArrayBuffer): string {
  const bytes = new Uint8Array(body)
  const a = fnv1a(bytes, 0x811c9dc5).toString(16).padStart(8, '0')
  const b = fnv1a(bytes, 0x9e3779b9).toString(16).padStart(8, '0')
  return `${a}${b}`
}

/** 在文件名前插入内容指纹；目录不变。`u/1-a.png` → `u/1-<hash>-a.png` */
export function withContentHash(path: string, hash: string): string {
  const slash = path.lastIndexOf('/')
  const dir = slash >= 0 ? path.slice(0, slash + 1) : ''
  const name = path.slice(slash + 1)
  return `${dir}${hash}-${name}`
}

type RawUploadResponse = { statusCode: number; data: unknown; errMsg?: string }

function requestUpload(
  url: string,
  body: ArrayBuffer,
  header: Record<string, string>,
  timeoutMs: number
): Promise<RawUploadResponse> {
  return new Promise((resolve) => {
    Taro.request({
      url,
      method: 'POST',
      header,
      data: body,
      timeout: timeoutMs,
      dataType: 'text',
      success: (res) => resolve({ statusCode: res.statusCode, data: res.data }),
      // 微信的网络失败 reject 的是 `{ errMsg }`，不是 Error；这里统一成 resolve，交给调用方换腿
      fail: (err) =>
        resolve({
          statusCode: 0,
          data: null,
          errMsg: (err as { errMsg?: string } | undefined)?.errMsg ?? '网络错误',
        }),
    })
  })
}

function responseMessage(data: unknown, status: number): string {
  if (typeof data === 'string' && data.trim()) {
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>
      const message = parsed.message ?? parsed.error ?? parsed.error_description
      if (typeof message === 'string' && message) return message
    } catch {
      return data.slice(0, 200)
    }
    return data.slice(0, 200)
  }
  if (data && typeof data === 'object') {
    const parsed = data as Record<string, unknown>
    const message = parsed.message ?? parsed.error ?? parsed.error_description
    if (typeof message === 'string' && message) return message
  }
  return `HTTP ${status}`
}

function isDuplicate(status: number, message: string): boolean {
  const lower = message.toLowerCase()
  return (
    status === 409 ||
    lower.includes('duplicate') ||
    lower.includes('already exists') ||
    lower.includes('resource already exists')
  )
}

/**
 * 上传一段字节。按 `storageUploadAttempts` 的顺序逐条尝试；网络失败/非 2xx 都换下一条。
 *
 * `idempotent` 为真时，第二条腿（或用户重试）拿到 `Duplicate` 视为成功：路径里已经
 * 带内容指纹，同一个路径上的对象按定义就是同一份内容。这不是「忽略错误」——非幂等
 * 路径（头像固定文件名、upsert），仍然会把 Duplicate 如实返回。
 */
export async function uploadStorageObject(options: {
  client: SupabaseClient<Database>
  bucket: string
  path: string
  body: ArrayBuffer
  contentType?: string
  upsert?: boolean
  idempotent?: boolean
}): Promise<StorageUploadResult> {
  const { client, bucket, path, body, contentType, upsert = false, idempotent = false } = options
  const attempts = storageUploadAttempts(bucket, path)
  let sessionToken: string | null = null
  try {
    const { data } = await client.auth.getSession()
    sessionToken = data.session?.access_token ?? null
  } catch {
    sessionToken = null
  }
  const anonKey =
    process.env.TARO_APP_SUPABASE_ANON_KEY ||
    (client as unknown as { supabaseKey?: string }).supabaseKey ||
    ''
  const header: Record<string, string> = {
    apikey: anonKey,
    authorization: `Bearer ${sessionToken || anonKey}`,
    'content-type': contentType || 'application/octet-stream',
  }
  if (upsert) header['x-upsert'] = 'true'

  let last: { message: string; status: number; entry: EntryName } | null = null
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index]
    // 每次复制一份：Taro.request 可能消费/转移 ArrayBuffer，第二条腿不能拿到空 body
    const res = await requestUpload(attempt.url, body.slice(0), header, attempt.timeoutMs)
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return { ok: true, entry: attempt.entry, attempts: index + 1 }
    }
    const message = res.errMsg || responseMessage(res.data, res.statusCode)
    if (idempotent && isDuplicate(res.statusCode, message)) {
      return { ok: true, entry: attempt.entry, attempts: index + 1 }
    }
    last = { message, status: res.statusCode, entry: attempt.entry }
  }
  return {
    ok: false,
    message: last?.message ?? '上传失败',
    entry: last?.entry ?? attempts[0]?.entry ?? 'direct',
    attempts: attempts.length,
    status: last?.status ?? 0,
  }
}

/**
 * 从 Storage 元数据补一个对象大小。旧分享/旧谱务行没有 `file_size` 时用它，
 * 让 PDF 仍能走分片下载（C6）。查询失败返回 null，调用方退回单次下载即可。
 */
export async function getStorageObjectSize(
  client: SupabaseClient<Database>,
  bucket: string,
  path: string
): Promise<number | null> {
  const slash = path.lastIndexOf('/')
  const folder = slash >= 0 ? path.slice(0, slash) : ''
  const name = path.slice(slash + 1)
  try {
    const { data, error } = await client.storage.from(bucket).list(folder, {
      search: name,
      limit: 100,
    })
    if (error || !data) return null
    const hit = data.find((item) => item.name === name)
    const size = Number(hit?.metadata?.size)
    return Number.isFinite(size) && size > 0 ? size : null
  } catch {
    return null
  }
}
