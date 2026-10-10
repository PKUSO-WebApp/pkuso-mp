/**
 * 阅读器内部类型。
 *
 * ⚠️ 这些文件（`pages/score-reader/lib/*`）必须留在分包目录内：它们只被阅读器页面
 * 引用，因而会被打进分包 chunk。若挪到 `src/lib/` 后被主包页面也引用一次，
 * Taro 就会把它们归进主包的 common.js——而分包存在的意义正是隔离 PDF 运行时的
 * 1.61MB（主包上限 2MB，基线已约 1.5MB）。
 */

export type Stage = 'idle' | 'fetching' | 'rendering' | 'ready' | 'error'
/**
 * 画布块。**三块**：一块显示中、一块放着「下一页」（预绘制）、一块放着「上一页」
 * （换帧后退役的那块，内容是刚离开的那页 ⇒ 免费）。见 lib/predraw.ts 的模型说明。
 */
export type Layer = 'a' | 'b' | 'c'

export type CanvasCtx = {
  setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void
  clearRect: (x: number, y: number, w: number, h: number) => void
  beginPath: () => void
  moveTo: (x: number, y: number) => void
  lineTo: (x: number, y: number) => void
  stroke: () => void
  fillRect: (x: number, y: number, w: number, h: number) => void
  getImageData: (x: number, y: number, w: number, h: number) => { data: ArrayLike<number> }
  /** 把整页 JPEG 画上去（见 lib/page-image.ts 的 paintPageImage） */
  drawImage: (img: unknown, x: number, y: number, w: number, h: number) => void
  /** 批注层按窗口锚点平移到「这一页在这一帧里的位置」时要用的三个 */
  save: () => void
  restore: () => void
  translate: (x: number, y: number) => void
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  lineCap: string
  lineJoin: string
  /** 荧光笔靠它半透明（见 anno-draw 的 styleFor）；画笔恒为 1 */
  globalAlpha: number
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

/**
 * 单指手势记录：起手快照 + 判定用的累计量（判定见 lib/gesture.ts、接线见 index.tsx）。
 *
 * `tx/ty/x/y` 是**平移分支原有的四个字段**（起手 client 坐标 + 起手时的平移），
 * 重构时刻意保留原语义，让「拖动平移」那条分支一行都不用改。
 */
export type Drag = {
  /** 起手触点 client 坐标 */
  tx: number
  ty: number
  /** 起手时的平移快照：判定为滑动翻页时要回滚到它，免得翻完页谱面莫名偏了一截 */
  x: number
  y: number
  /** 起手落点相对视口左上角（分区与灰带命中用它，见 lib/layout.ts） */
  relX: number
  relY: number
  /** 起手时刻（Date.now()；不用 e.timeStamp——小程序端语义不稳） */
  startAt: number
  /** 手势期间 |dx| / |dy| 的最大值——判 tap 用它而不是末点（横滑出去再滑回来会骗人） */
  maxMove: number
  /** 起手是否落在灰带里：灰带任意横向位置都只开关菜单，永不翻页 */
  band: 'top' | 'bottom' | null
  /** 起手快照：本段手势结束时还允不允许**翻页**（仅左右模式：未放大 && 文档就绪；批注模式不建记录） */
  canTurn: boolean
  /** 起手快照：本段手势结束时还允不允许**按分区滚动**（仅上下模式：文档就绪即可，放大后也允许） */
  canScroll: boolean
}

/**
 * 一次渲染请求：把哪一页按哪个缩放渲出来。
 * `bg = true` 是**后台预绘制**（低优先级、可被交互任务让位，见 lib/predraw.ts）。
 */
export type Job = { page: number; zoom: number; bg?: boolean }
