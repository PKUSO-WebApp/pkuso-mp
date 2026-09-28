import Taro from '@tarojs/taro'
import type { SheetMusicFileRow } from '@/types/database'

/**
 * 本地 PDF 缓存 + 阅读位置（书签）：同一份谱子不必每次重下，回来停在上次那页。
 *
 * 缓存一律「指纹不符就当没有」：指纹是 storage_path + 文件大小（后端没有 updated_at，
 * 但换文件必换大小）。读/写失败全部静默回落网络或下次重下——缓存是优化，不该成为
 * 阅读失败的原因。
 */

export const pdfCacheKey = (fileId: string) => `score-pdf-cache:${fileId}`
export const lastPageKey = (fileId: string) => `score-last-page:${fileId}`
export const pdfCachePath = (fileId: string) => `${Taro.env.USER_DATA_PATH}/score-${fileId}.pdf`

/** 缓存指纹：storage_path + 文件大小。后端没有 updated_at，但换文件必换大小 */
export const pdfCacheTag = (row: SheetMusicFileRow) => `${row.storage_path}|${row.file_size ?? 0}`

/** 读本地缓存的 PDF；缺失/指纹不符/读失败一律 null，由调用方回落网络 */
export async function readCachedPdf(fileId: string, tag: string): Promise<ArrayBuffer | null> {
  try {
    const rec = Taro.getStorageSync(pdfCacheKey(fileId)) as { tag?: string } | ''
    if (!rec || typeof rec !== 'object' || rec.tag !== tag) return null
    return await new Promise<ArrayBuffer>((resolve, reject) => {
      Taro.getFileSystemManager().readFile({
        filePath: pdfCachePath(fileId),
        success: (res) => resolve(res.data as ArrayBuffer),
        fail: reject,
      })
    })
  } catch {
    return null
  }
}

/** 把刚下载的字节落到本地（不挡首帧）；失败静默，下次重下即可 */
export function writeCachedPdf(fileId: string, tag: string, bytes: ArrayBuffer): void {
  try {
    Taro.getFileSystemManager().writeFile({
      filePath: pdfCachePath(fileId),
      data: bytes,
      success: () => Taro.setStorageSync(pdfCacheKey(fileId), { tag }),
      fail: () => {},
    })
  } catch {
    // 缓存失败不影响阅读
  }
}

/** 本地已缓存的文件路径（没有则 null），供「原生打开」直接复用 */
export function cachedPdfPath(fileId: string): string | null {
  if (!fileId) return null
  try {
    const rec = Taro.getStorageSync(pdfCacheKey(fileId)) as { tag?: string } | ''
    if (!rec || typeof rec !== 'object' || !rec.tag) return null
    return pdfCachePath(fileId)
  } catch {
    return null
  }
}
