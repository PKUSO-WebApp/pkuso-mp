import Taro from '@tarojs/taro'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

/** 微信小程序：tempFilePath 为本地临时文件路径（非 DOM File），必须用 API 读出字节后上传；
 * 直接把 { tempFilePath } 对象作为上传体，storage-js 会判定为非法上传体而上传失败/上传非图片内容。 */
export function readTempFileBytes(tempFilePath: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    Taro.getFileSystemManager().readFile({
      filePath: tempFilePath,
      success: (res) => resolve(res.data as ArrayBuffer),
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
