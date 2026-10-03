import Taro from '@tarojs/taro'
import { pageImageUrl } from '@/lib/score-page-image'
import type { CanvasImage, CanvasNode } from './types'

export { pageImageUrl }

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
 * 加载一页页图（onload 才算完成）；失败抛出，调用方走既有错误路径。
 *
 * 尺寸直接取自图片对象 —— 不需要额外的 `getImageInfo`（少一次文件/网络往返）。
 */
export async function loadPageImage(node: CanvasNode, url: string): Promise<LoadedPageImage> {
  if (typeof node.createImage !== 'function') {
    throw new Error('canvas node 不支持 createImage（无法显示页图）')
  }
  const img = node.createImage()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('页图加载超时')), PAGE_IMAGE_TIMEOUT_MS)
    img.onload = () => {
      clearTimeout(timer)
      resolve()
    }
    img.onerror = () => {
      clearTimeout(timer)
      reject(new Error('页图加载失败'))
    }
    // onload/onerror 挂好之后再赋 src —— 反过来会漏掉同步完成的加载
    img.src = url
  })
  return { img, width: img.width ?? 0, height: img.height ?? 0 }
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

/** 预取一页（下载进微信的图片缓存）。失败无所谓 —— 真翻到那页时会再拉一次。 */
export function prefetchPageImage(url: string): void {
  void Taro.getImageInfo({ src: url }).catch(() => {})
}
