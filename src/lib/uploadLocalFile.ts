import Taro from '@tarojs/taro'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

/** 标准 base64 → ArrayBuffer（不依赖 atob/wx.base64ToArrayBuffer，跨环境可用）。 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const lookup = new Uint8Array(256)
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i
  // 去掉 data URI 前缀、换行、padding 等非 base64 字符
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '')
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let buffer = 0
  let bits = 0
  let idx = 0
  for (let i = 0; i < clean.length; i++) {
    buffer = (buffer << 6) | lookup[clean.charCodeAt(i)]
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[idx++] = (buffer >> bits) & 0xff
    }
  }
  return bytes.buffer
}

/** 微信小程序：tempFilePath 为本地临时文件路径（非 DOM File），必须用 API 读出字节后上传；
 * 直接把 { tempFilePath } 对象作为上传体，storage-js 会判定为非法上传体而上传失败/上传非图片内容。
 * 注意：readFile 成功回调的 res.data 在不同基础库下可能是 ArrayBuffer、Uint8Array（ArrayBufferView）
 * 或 base64 字符串，这里统一归一化为真正的 ArrayBuffer，否则 storage-js 发出的请求体是 typed array，
 * 会被 Taro fetch 适配层（toTaroBody）判为「不支持该请求体类型」而抛错。 */
export function readTempFileBytes(tempFilePath: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    Taro.getFileSystemManager().readFile({
      filePath: tempFilePath,
      success: (res) => {
        const data = res.data
        if (data instanceof ArrayBuffer) return resolve(data)
        if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(data)) {
          const view = data as ArrayBufferView
          return resolve(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength))
        }
        if (typeof data === 'string') {
          try {
            return resolve(base64ToArrayBuffer(data))
          } catch {
            return reject(new Error('读取本地附件失败：base64 解析失败'))
          }
        }
        reject(new Error('读取本地附件失败：未知数据格式'))
      },
      fail: (err) => reject(new Error(err?.errMsg || '读取本地附件失败')),
    })
  })
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
}

/** 按扩展名猜测 MIME，供上传时设置 contentType（缺省则不传，由存储端推断）。 */
export function guessContentType(name: string): string | undefined {
  const ext = name.split('.').pop()?.toLowerCase()
  return ext ? CONTENT_TYPE_BY_EXT[ext] : undefined
}

/**
 * 通用本地文件上传：读出微信本地临时文件的字节后上传到指定存储桶。
 * 供请假附件、未来帖子图片等所有「小程序本地文件 → Supabase Storage」场景复用。
 *
 * @param client   注入的 Supabase 客户端（便于测试）
 * @param bucket   目标存储桶（如 'leave-attachments'）
 * @param path     目标对象路径（含 userId/时间戳等前缀）
 * @param tempFilePath  Taro.chooseMedia 等返回的本地临时路径
 * @param contentType  可选 MIME，未传则不设置（由存储端按扩展名推断）
 */
export async function uploadLocalFile(
  client: SupabaseClient<Database>,
  bucket: string,
  path: string,
  tempFilePath: string,
  contentType?: string
): Promise<{ data: { path: string } | null; error: { message: string } | null }> {
  try {
    const body = await readTempFileBytes(tempFilePath)
    const { error } = await client.storage
      .from(bucket)
      .upload(path, body, { upsert: false, ...(contentType ? { contentType } : {}) })
    if (error) return { data: null, error }
    return { data: { path }, error: null }
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : '附件读取失败' } }
  }
}
