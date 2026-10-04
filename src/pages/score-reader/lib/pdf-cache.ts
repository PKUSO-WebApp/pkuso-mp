import Taro from '@tarojs/taro'
import type { SheetMusicFileRow } from '@/types/database'

/**
 * 本地 PDF 缓存 + 阅读位置（书签）：同一份谱子不必每次重下，回来停在上次那页。
 *
 * 缓存一律「指纹不符就当没有」：指纹是 storage_path + 文件大小（后端没有 updated_at，
 * 但换文件必换大小）。读/写失败全部静默回落网络或下次重下——缓存是优化，不该成为
 * 阅读失败的原因。
 *
 * **容量**：微信给小程序「本地用户文件 + 本地缓存文件」的总配额是 200MB（官方文档）。
 * 这份缓存独占其中一部分，所以按 `PDF_CACHE_BUDGET_BYTES` 自管 LRU——不然写满之后
 * `writeFile` 会开始静默失败（错误码 1300202），表现是「新谱子永远进不了缓存、
 * 老谱子也不腾地方」。页图不走这里（走微信图片层，见 lib/page-image.ts）。
 */

export const pdfCacheKey = (fileId: string) => `score-pdf-cache:${fileId}`
export const lastPageKey = (fileId: string) => `score-last-page:${fileId}`
export const pdfCachePath = (fileId: string) => `${Taro.env.USER_DATA_PATH}/score-${fileId}.pdf`

/** 缓存指纹：storage_path + 文件大小。后端没有 updated_at，但换文件必换大小 */
export const pdfCacheTag = (row: SheetMusicFileRow) => `${row.storage_path}|${row.file_size ?? 0}`

/** 缓存账本（storage 里的一个 JSON 数组）：淘汰时要按大小和年龄算，光看文件算不出来 */
const INDEX_KEY = 'score-pdf-cache-index'

/** 自管预算：200MB 是整只小程序的上限（还有临时文件等其他占用），留足余量 */
export const PDF_CACHE_BUDGET_BYTES = 120 * 1024 * 1024

export type PdfCacheEntry = { fileId: string; tag: string; size: number; at: number }

/**
 * 超预算时该淘汰哪些（最旧优先，淘汰到总量落回预算内为止）。
 *
 * `incoming` 是这次要写进去的字节数——先算进来，才能保证写完之后不越界。
 * 纯函数：淘汰策略是本模块唯一值得单测的东西。
 */
export function pickEvictions(
  entries: readonly PdfCacheEntry[],
  budgetBytes: number,
  incoming = 0
): PdfCacheEntry[] {
  const total = entries.reduce((sum, e) => sum + e.size, 0) + incoming
  if (total <= budgetBytes) return []
  const byAge = [...entries].sort((a, b) => a.at - b.at)
  const out: PdfCacheEntry[] = []
  let over = total - budgetBytes
  for (const e of byAge) {
    if (over <= 0) break
    out.push(e)
    over -= e.size
  }
  return out
}

function readIndex(): PdfCacheEntry[] {
  try {
    const raw = Taro.getStorageSync(INDEX_KEY)
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (e): e is PdfCacheEntry =>
        !!e && typeof e === 'object' && typeof e.fileId === 'string' && typeof e.size === 'number'
    )
  } catch {
    return []
  }
}

function writeIndex(entries: PdfCacheEntry[]): void {
  try {
    Taro.setStorageSync(INDEX_KEY, entries)
  } catch {
    /* 账本写不进去只会让淘汰失准，不影响阅读 */
  }
}

/** 淘汰一批：删文件 + 清掉它的指纹 key（失败静默，下次写还会再试） */
function evict(entries: readonly PdfCacheEntry[]): void {
  const fs = Taro.getFileSystemManager()
  for (const e of entries) {
    try {
      fs.unlink({ filePath: pdfCachePath(e.fileId), success: () => {}, fail: () => {} })
      Taro.removeStorageSync(pdfCacheKey(e.fileId))
    } catch {
      /* ignore */
    }
  }
}

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

/**
 * 把刚下载的字节落到本地（不挡首帧）；失败静默，下次重下即可。
 *
 * 先按账本淘汰再写：这样「写满 200MB 之后全部静默失败」不会发生。
 */
export function writeCachedPdf(fileId: string, tag: string, bytes: ArrayBuffer): void {
  const size = bytes.byteLength
  const others = readIndex().filter((e) => e.fileId !== fileId)
  const doomed = pickEvictions(others, PDF_CACHE_BUDGET_BYTES, size)
  if (doomed.length > 0) {
    evict(doomed)
    // eslint-disable-next-line no-console
    console.log('[score-reader] pdf cache evict', { count: doomed.length })
  }
  const kept = others.filter((e) => !doomed.includes(e))
  const entry: PdfCacheEntry = { fileId, tag, size, at: Date.now() }
  try {
    Taro.getFileSystemManager().writeFile({
      filePath: pdfCachePath(fileId),
      data: bytes,
      success: () => {
        Taro.setStorageSync(pdfCacheKey(fileId), { tag })
        writeIndex([...kept, entry])
      },
      // 写失败（配额等）：别把它记进账本，否则淘汰会按「它还在」来算
      fail: () => writeIndex(kept),
    })
  } catch {
    // 缓存失败不影响阅读
    writeIndex(kept)
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
