import Taro from '@tarojs/taro'
import type { CanvasNode } from './types'

/**
 * 页图（上传时预渲染的整页 JPEG）的取用：本地缓存优先，否则下载并落盘。
 *
 * 为什么需要：小程序里 pdf.js 只能纯 JS 解码每页 JPEG（一页 300dpi 扫描件约 6 秒，
 * iOS 真机还会静默白屏）。页图由 web 端在上传时预渲染（pkuso-web #378/#379），
 * 阅读器只负责下载 + 显示——原生解码，每页几十毫秒。
 *
 * ⚠️ 路径规则与 web 端 `sheetMusicPagePath` **必须一致**（`{storage_path 去 .pdf}/p{n}.jpg`）。
 * 两边各写一份规则，改这里时同步改 `pkuso-web/src/lib/storage.ts`。
 */

/** 第 n 页页图的公开 URL（PDF 的 publicUrl 去 `.pdf` + `/p{n}.jpg`，与 web 端同规则） */
export function pageImageUrl(pdfPublicUrl: string, pageNo: number): string {
  return `${pdfPublicUrl.replace(/\.pdf$/, '')}/p${pageNo}.jpg`
}

const cacheDir = (fileId: string): string => `${Taro.env.USER_DATA_PATH}/score-pages/${fileId}`
const cachePath = (fileId: string, pageNo: number): string => `${cacheDir(fileId)}/p${pageNo}.jpg`

/** 本地文件是否存在（探测失败一律当「不存在」——两种结果对调用方都是「得重下」） */
function fileExists(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      Taro.getFileSystemManager().access({
        path,
        success: () => resolve(true),
        fail: () => resolve(false),
      })
    } catch {
      resolve(false)
    }
  })
}

/**
 * 取第 n 页页图的**本地路径**：缓存命中直接返回，否则下载 + 落盘。
 *
 * 落盘失败不致命——退回临时文件路径照样能显示，代价只是下次还要重下。
 * 下载失败**抛出**：调用方走既有错误路径（`setStage('error')` + 上报）。
 */
export async function ensurePageImage(
  fileId: string,
  url: string,
  pageNo: number
): Promise<string> {
  const local = cachePath(fileId, pageNo)
  if (await fileExists(local)) return local

  const res = await Taro.downloadFile({ url })
  if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`)

  try {
    await new Promise<void>((resolve) => {
      // 目录已存在时 mkdir 也会 fail —— 两种都继续，让 copyFile 报真正的错
      Taro.getFileSystemManager().mkdir({
        dirPath: cacheDir(fileId),
        recursive: true,
        success: () => resolve(),
        fail: () => resolve(),
      })
    })
    await new Promise<void>((resolve, reject) => {
      Taro.getFileSystemManager().copyFile({
        srcPath: res.tempFilePath,
        destPath: local,
        success: () => resolve(),
        fail: (err) => reject(new Error(err?.errMsg || 'copyFile failed')),
      })
    })
    return local
  } catch {
    return res.tempFilePath
  }
}

/**
 * 把页图画进画布（**位图像素坐标系**——与 raster.ts 的记号/探测同一坐标系，
 * 所以 `setTransform(1,0,0,1,0,0)` 后直接按位图尺寸画）。
 *
 * 画布尺寸在这里设（pdf.js 路径是 `renderPage` 内部设的，图片模式得自己来）。
 * 图片由小程序原生解码（毫秒级），这正是本模式存在的意义。
 */
export async function drawPageImage(
  node: CanvasNode,
  localPath: string,
  bitmapW: number,
  bitmapH: number
): Promise<void> {
  if (typeof node.createImage !== 'function') {
    throw new Error('canvas node 不支持 createImage（无法显示页图）')
  }
  node.width = bitmapW
  node.height = bitmapH
  const ctx = node.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, bitmapW, bitmapH)

  const img = node.createImage()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('页图解码失败'))
    // onload/onerror 挂好之后再赋 src —— 反过来会漏掉同步完成的加载
    img.src = localPath
  })
  ctx.drawImage(img, 0, 0, bitmapW, bitmapH)
}
