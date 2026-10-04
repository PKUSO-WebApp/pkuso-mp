import type { CanvasImage, CanvasNode } from './types'

/**
 * 页图（上传时预渲染的整页 JPEG）的加载与绘制。
 *
 * **刻意不做本地文件缓存**：直接把网络 URL 交给小程序的图片层 —— 微信自己有图片缓存
 * （磁盘 LRU），重复打开同一页由它负责，占空间也有上限。自己落盘要管目录、失效、清理，
 * 收益并不更大。
 *
 * ⚠️ 这也是为什么**不用** `Taro.downloadFile`：它**不走 HTTP 缓存**，每次都是真下载；
 * 而 `canvas.createImage` / `getImageInfo` 走小程序统一的图片加载（吃缓存）。
 * 页图加载慢先看这个区别。
 *
 * ⚠️ 路径规则与 web 端 `sheetMusicPagePath` 必须一致（`{storage_path 去 .pdf}/p{n}.jpg`）。
 */

/**
 * 页图加载超时（毫秒）。
 *
 * 弱网下 500KB 的图确实可能要几十秒，但**不能无限等**：实测有用户在 iOS 上卡了
 * 150 秒（服务端日志显示那次请求根本没到达 —— 卡在客户端网络栈）。超时后走错误态
 *（带重试），比无声等待强。
 *
 * ⚠️ 超时只是**放弃等待**，微信那边的加载还在跑（`createImage` 没有取消接口）——
 * 成功也不会再被采用，属可接受的浪费。
 */
const PAGE_IMAGE_TIMEOUT_MS = 30000

/** 一页已加载的页图（尺寸在 onload 之后才有） */
export type LoadedPageImage = { img: CanvasImage; width: number; height: number }

/**
 * 页图加载失败时抛出的错误，额外带上两条**只有这里能拿到**的诊断信息：
 * - `urlIndex`：候选 URL 里第几条失败（0 = 反代、1 = 直连）——区分「哪条腿不通」；
 * - `errMsg`：图片层 `onerror` 的原始文案（部分版本会给出原因，例如
 *   `url not in domain list`）。没有它，「网络/入口」与「域名白名单/解码被拒」
 *   在事后完全分不开（onerror 不带状态码，屏幕上只有一句「加载失败」）。
 */
export type PageImageError = Error & { urlIndex?: number; errMsg?: string }

/** 从 onerror 的回传里尽量榨出可读文案（形态随版本不同，所以什么都接一下） */
function detailOf(e: unknown): string {
  try {
    if (!e) return ''
    if (typeof e === 'string') return e
    const any = e as { errMsg?: unknown; detail?: { errMsg?: unknown } }
    const msg = any.errMsg ?? any.detail?.errMsg
    if (typeof msg === 'string') return msg
    return JSON.stringify(e).slice(0, 200)
  } catch {
    return ''
  }
}

/**
 * 加载一页页图（onload 才算完成）；失败抛出，调用方走既有错误路径。
 *
 * 尺寸直接取自图片对象 —— 不需要额外的 `getImageInfo`（少一次文件/网络往返）。
 */
/** 单个 URL 的加载（onload 才算完成） */
function loadOnePageImage(
  node: CanvasNode,
  url: string,
  timeoutMs: number
): Promise<LoadedPageImage> {
  const img = node.createImage!()
  return new Promise<LoadedPageImage>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('页图加载超时')), timeoutMs)
    img.onload = () => {
      clearTimeout(timer)
      resolve({ img, width: img.width ?? 0, height: img.height ?? 0 })
    }
    img.onerror = (e) => {
      clearTimeout(timer)
      const err = new Error('页图加载失败') as PageImageError
      const msg = detailOf(e)
      if (msg) err.errMsg = msg
      reject(err)
    }
    // onload/onerror 挂好之后再赋 src —— 反过来会漏掉同步完成的加载
    img.src = url
  })
}

/**
 * 加载一页页图，**依次尝试候选 URL**（见 `pageImageUrls`：反代优先、直连兜底）。
 *
 * 第一个（反代）用较短超时——它该快，慢了说明这条腿不通，没必要占着用户等待；
 * 后面的（直连）给足 30 秒，弱网下 500KB 确实可能要几十秒。
 */
export async function loadPageImage(node: CanvasNode, urls: string[]): Promise<LoadedPageImage> {
  if (typeof node.createImage !== 'function') {
    throw new Error('canvas node 不支持 createImage（无法显示页图）')
  }
  let lastErr: PageImageError | null = null
  for (let i = 0; i < urls.length; i += 1) {
    try {
      return await loadOnePageImage(node, urls[i], i === 0 ? 15000 : PAGE_IMAGE_TIMEOUT_MS)
    } catch (err) {
      const e = (err instanceof Error ? err : new Error(String(err))) as PageImageError
      e.urlIndex = i
      lastErr = e
    }
  }
  throw lastErr ?? new Error('页图加载失败')
}

/**
 * 把已加载的页图画进画布（**位图像素坐标系** —— 与 raster.ts 的记号/探测同一坐标系，
 * 所以 `setTransform(1,0,0,1,0,0)` 后直接按位图尺寸画）。
 * 画布尺寸在这里设（pdf.js 路径是 `renderPage` 内部设的，图片模式得自己来）。
 */
export function paintPageImage(
  node: CanvasNode,
  img: CanvasImage,
  bitmapW: number,
  bitmapH: number
): void {
  node.width = bitmapW
  node.height = bitmapH
  const ctx = node.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, bitmapW, bitmapH)
  ctx.drawImage(img, 0, 0, bitmapW, bitmapH)
}

/**
 * 取图失败后的退避重试间隔（数组长度 = 重试次数）。
 *
 * 为什么值得重试：图片层在**高并发或瞬时抖动**下会当场拒绝（`onerror` 连原因都不给），
 * 而这类拒绝往往是"这一刻的"——退避一拍再来基本就好。真机实测过一次：泵 4 个在飞时，
 * 前台那次取图被当场拒掉，两条腿都没到服务器（2026-10-04）。
 */
export const PAGE_IMAGE_RETRY_DELAYS_MS = [500, 1000]

/**
 * 取图 + 退避重试（默认失败后重试两次）。全部失败时抛**最后一次**的错误
 * （它带着 urlIndex / errMsg，见 loadPageImage）。
 *
 * `sleep` 可注入，测试里不用真等。
 */
export async function loadPageImageWithRetry(
  node: CanvasNode,
  urls: string[],
  opts: { delaysMs?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {}
): Promise<LoadedPageImage> {
  const delays = opts.delaysMs ?? PAGE_IMAGE_RETRY_DELAYS_MS
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let lastErr: unknown
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await loadPageImage(node, urls)
    } catch (err) {
      lastErr = err
      if (attempt < delays.length) await sleep(delays[attempt] ?? 0)
    }
  }
  throw lastErr
}

/** 预取/预热统一走 `lib/prefetch-pump.ts`（串行泵 + 优先带；此前的单页预取已由它取代）。
 *  预绘制（doPredraw）**刻意不走重试**：它是后台补充、随时可能被交互打断，重试只会白占额度。 */
