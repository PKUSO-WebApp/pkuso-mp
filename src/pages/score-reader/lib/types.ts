/**
 * 阅读器内部类型。
 *
 * ⚠️ 这些文件（`pages/score-reader/lib/*`）必须留在分包目录内：它们只被阅读器页面
 * 引用，因而会被打进分包 chunk。若挪到 `src/lib/` 后被主包页面也引用一次，
 * Taro 就会把它们归进主包的 common.js——而分包存在的意义正是隔离 PDF 运行时的
 * 1.61MB（主包上限 2MB，基线已约 1.5MB）。
 */

export type Stage = 'idle' | 'fetching' | 'parsing' | 'rendering' | 'ready' | 'error'
export type Layer = 'a' | 'b'

export type CanvasCtx = {
  setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void
  clearRect: (x: number, y: number, w: number, h: number) => void
  beginPath: () => void
  moveTo: (x: number, y: number) => void
  lineTo: (x: number, y: number) => void
  stroke: () => void
  fillRect: (x: number, y: number, w: number, h: number) => void
  getImageData: (x: number, y: number, w: number, h: number) => { data: ArrayLike<number> }
  /** 图片模式（页图）用它把整页 JPEG 画上去；pdf.js 路径不经过它 */
  drawImage: (img: unknown, x: number, y: number, w: number, h: number) => void
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  lineCap: string
  lineJoin: string
}
export type CanvasNode = {
  width: number
  height: number
  getContext: (type: '2d') => CanvasCtx
  /** 小程序 canvas node 的原生图片对象（图片模式用它解码 JPEG，毫秒级） */
  createImage?: () => CanvasImage
}

/** 小程序 `canvas.createImage()` 返回的对象（只有我们用到的最小子集） */
export type CanvasImage = {
  src: string
  width?: number
  height?: number
  onload: (() => void) | null
  onerror: ((err: unknown) => void) | null
}

/** 内容框左上角相对视口的位置（px，可为负） */
export type Pan = { x: number; y: number }

/** 双指手势起始快照：缩放/位移基准 + 中点基准（相对视口左上角） */
export type Pinch = {
  dist: number
  zoom: number
  pan: Pan
  midX: number
  midY: number
}

/** 单指拖动起始快照 */
export type Drag = { tx: number; ty: number; x: number; y: number }

/** 一次渲染请求：把哪一页按哪个缩放渲出来 */
export type Job = { page: number; zoom: number }

/** 白帧重试记账：同一页/同一缩放重试到第几次 */
export type BlankRetry = { page: number; zoom: number; n: number }
