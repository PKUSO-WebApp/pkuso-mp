import Taro from '@tarojs/taro'
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

/** 第 n 页页图的公开 URL（PDF 的 publicUrl 去 `.pdf` + `/p{n}.jpg`，与 web 端同规则） */
export function pageImageUrl(pdfPublicUrl: string, pageNo: number): string {
  return `${pdfPublicUrl.replace(/\.pdf$/, '')}/p${pageNo}.jpg`
}

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
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('页图加载失败'))
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
