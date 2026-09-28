import { useCallback, useEffect, useRef, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { View, Canvas, Input, Button, Text } from '@tarojs/components'
import type { ITouchEvent } from '@tarojs/components'
import { supabase } from '@/lib/supabase'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import { useMyProfile } from '@/hooks/useMyProfile'
import { AnnotationBar } from '@/components/score/AnnotationBar'
import {
  PEN_COLORS,
  PEN_WIDTHS,
  loadAnnoDoc,
  saveAnnoDoc,
  type AnnoDoc,
  type AnnoStroke,
} from '@/lib/annotation'
import { createPdfEngine, type PdfDocument, type PdfEngine } from '@vendor/wechat-miniprogram-pdf'
import type { SheetMusicFileRow } from '@/types/database'
import './index.scss'

const DEFAULT_URL = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'
const ZOOM_MIN = 0.5
const ZOOM_MAX = 4
const DPR = 2
/** 缩放合并窗口：停手满这么久才真正重渲（期间画布只换尺寸，不清屏） */
const ZOOM_SETTLE_MS = 180
/** 手写进行中推迟渲染的重试间隔 */
const RENDER_RETRY_MS = 140
/** 渲完后第一次读到白：再等一拍复核（绘图指令是异步落到原生侧的） */
const PROBE_RECHECK_MS = 150
/** 白帧重试的间隔（第 n 次等 n 倍）与上限；用尽后重开文档 */
const BLANK_RETRY_MS = 400
const BLANK_MAX_RETRY = 2
/** 重开文档的节流窗口：同一页这段时间内只重开一次 */
const RELOAD_COOLDOWN_MS = 15000
/** 诊断日志保留条数（屏幕上只显示最后几条，点一下可复制全部） */
const DBG_MAX_LINES = 100
const DBG_SHOW_LINES = 5
/** 位图上限：单边别超 4096、总量别超 12M 像素（约 48MB）——
 *  真机上超限的画布会分配失败/画不出来，表现就是「整页白」 */
const MAX_RASTER_EDGE = 4096
const MAX_RASTER_PIXELS = 12000000
/** 备用帧停靠位置：移出视口即可（overflow:hidden 会裁掉），它仍是正常在绘制的画布 */
const OFFSCREEN = '-99999px'

type Stage = 'idle' | 'fetching' | 'parsing' | 'rendering' | 'ready' | 'error'
type Layer = 'a' | 'b'

type CanvasCtx = {
  setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void
  clearRect: (x: number, y: number, w: number, h: number) => void
  beginPath: () => void
  moveTo: (x: number, y: number) => void
  lineTo: (x: number, y: number) => void
  stroke: () => void
  fillRect: (x: number, y: number, w: number, h: number) => void
  getImageData: (x: number, y: number, w: number, h: number) => { data: ArrayLike<number> }
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  lineCap: string
  lineJoin: string
}
type CanvasNode = {
  width: number
  height: number
  getContext: (type: '2d') => CanvasCtx
}

/** 内容框左上角相对视口的位置（px，可为负） */
type Pan = { x: number; y: number }

/** 双指手势起始快照：缩放/位移基准 + 中点基准（相对视口左上角） */
type Pinch = {
  dist: number
  zoom: number
  pan: Pan
  midX: number
  midY: number
}

/** 单指拖动起始快照 */
type Drag = { tx: number; ty: number; x: number; y: number }

/** 一次渲染请求：把哪一页按哪个缩放渲出来 */
type Job = { page: number; zoom: number }

/** 白帧重试记账：同一页/同一缩放重试到第几次 */
type BlankRetry = { page: number; zoom: number; n: number }

/** 画布位图用的像素比：按上限压，超限时宁可软一点也不画不出来 */
function rasterDpr(cssW: number, cssH: number): number {
  if (cssW <= 0 || cssH <= 0) return DPR
  const edge = Math.min(MAX_RASTER_EDGE / (cssW * DPR), MAX_RASTER_EDGE / (cssH * DPR))
  const area = Math.sqrt(MAX_RASTER_PIXELS / (cssW * cssH * DPR * DPR))
  return Math.min(1, edge, area) * DPR
}

/**
 * 渲前在画布角上点一个洋红记号。渲完记号还在 = 这次渲染**根本没碰这块画布**
 * （否则 pdf.js 的底色填充会把它盖掉）。用来区分「空渲染」和「没渲染」
 */
function drawMark(node: CanvasNode): void {
  try {
    const ctx = node.getContext('2d')
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#ff00ff'
    ctx.fillRect(0, 0, 4, 4)
  } catch {
    // 记号画不上不影响主流程
  }
}

function markKept(node: CanvasNode): boolean {
  try {
    const d = node.getContext('2d').getImageData(1, 1, 1, 1).data
    return d[0] > 200 && d[1] < 80 && d[2] > 200
  } catch {
    return false
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// ---- 本地 PDF 缓存 + 阅读位置（书签）：同一份谱子不必每次重下，回来停在上次那页 ----
const pdfCacheKey = (fileId: string) => `score-pdf-cache:${fileId}`
const lastPageKey = (fileId: string) => `score-last-page:${fileId}`
const pdfCachePath = (fileId: string) => `${Taro.env.USER_DATA_PATH}/score-${fileId}.pdf`

/** 缓存指纹：storage_path + 文件大小。后端没有 updated_at，但换文件必换大小 */
const pdfCacheTag = (row: SheetMusicFileRow) => `${row.storage_path}|${row.file_size ?? 0}`

/** 读本地缓存的 PDF；缺失/指纹不符/读失败一律 null，由调用方回落网络 */
async function readCachedPdf(fileId: string, tag: string): Promise<ArrayBuffer | null> {
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
function writeCachedPdf(fileId: string, tag: string, bytes: ArrayBuffer): void {
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
function cachedPdfPath(fileId: string): string | null {
  if (!fileId) return null
  try {
    const rec = Taro.getStorageSync(pdfCacheKey(fileId)) as { tag?: string } | ''
    if (!rec || typeof rec !== 'object' || !rec.tag) return null
    return pdfCachePath(fileId)
  } catch {
    return null
  }
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/** 内容框位置钳制：比视口小的一轴居中，比视口大的一轴不拉出空白 */
function clampPan(p: Pan, w: number, h: number, vw: number, vh: number): Pan {
  if (vw <= 0 || vh <= 0) return p
  const x = w <= vw ? (vw - w) / 2 : clamp(p.x, vw - w, 0)
  const y = h <= vh ? (vh - h) / 2 : clamp(p.y, vh - h, 0)
  return x === p.x && y === p.y ? p : { x, y }
}

function touchDist(touches: { clientX: number; clientY: number }[]): number {
  const [a, b] = touches
  if (!a || !b) return 0
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

function touchMid(touches: { clientX: number; clientY: number }[]): [number, number] {
  const [a, b] = touches
  if (!a || !b) return [0, 0]
  return [(a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2]
}

function styleFor(ctx: CanvasCtx, color: string, width: number, w: number): void {
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1, width * w)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}

/** 归一化点序列 → 画布像素折线 */
function drawPolylineOn(
  ctx: CanvasCtx,
  pts: [number, number][],
  color: string,
  width: number,
  w: number,
  h: number
): void {
  if (pts.length === 0) return
  styleFor(ctx, color, width, w)
  ctx.beginPath()
  pts.forEach(([x, y], i) => {
    const px = x * w
    const py = y * h
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  })
  ctx.stroke()
}

function drawStrokeOn(ctx: CanvasCtx, stroke: AnnoStroke, w: number, h: number): void {
  drawPolylineOn(ctx, stroke.points, stroke.color, stroke.width, w, h)
}

/**
 * 抽样看这一帧有没有墨：渲染静默失败（pdf.js resolve 了但一个操作都没落下去）
 * 时整块画布是纯白，这里能看出来。返回 -1 表示探测本身失败，不参与判定。
 */
function frameInk(node: CanvasNode): number {
  try {
    const ctx = node.getContext('2d')
    if (!ctx?.getImageData) return -1
    const w = node.width
    const h = node.height
    if (!w || !h) return -1
    // 取三条整行（比单点采样可靠得多）：某行存在非白像素就算这行有墨。
    // 返回有几行有墨（0~3），0 表示整帧纯白 —— 就是渲染静默失败的样子
    let inkRows = 0
    for (const fy of [0.25, 0.5, 0.75]) {
      const d = ctx.getImageData(0, Math.floor(fy * h), w, 1).data
      for (let i = 0; i < d.length; i += 4) {
        if (!(d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245)) {
          inkRows++
          break
        }
      }
    }
    return inkRows
  } catch {
    return -1
  }
}

export default function ScoreReader() {
  const { t } = useT()
  const darkClass = useThemeClass()
  useNavTitle('scoreReader.navTitle')
  const router = useRouter()
  const { profile } = useMyProfile()

  const fileId = router.params.file_id ? decodeURIComponent(router.params.file_id) : ''
  const presetUrl = router.params.url ? decodeURIComponent(router.params.url) : ''

  const [url, setUrl] = useState(presetUrl || DEFAULT_URL)
  const [stage, setStage] = useState<Stage>('idle')
  const [message, setMessage] = useState('')
  const [pageCount, setPageCount] = useState(0)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 })
  const [containerW, setContainerW] = useState(0)
  const [containerH, setContainerH] = useState(0)
  const [docTick, setDocTick] = useState(0)
  // 内容框位置：平移完全自己算（不用 scroll-view，双指手势才能锚定中点）
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 })
  // 双缓冲：显示帧在 a 或 b，渲染永远渲到另一块，渲完换帧
  const [activeLayer, setActiveLayer] = useState<Layer>('a')
  // 页码输入框：编辑期间用本地文本，不被 page 的 clamp 回写打断
  const [pageInput, setPageInput] = useState('1')
  const [pageEditing, setPageEditing] = useState(false)
  // 双指手势结束计数：手势中批注层不重画，结束时补一次
  const [gestureTick, setGestureTick] = useState(0)

  // 批注：画笔开关、颜色、线宽、当前文件全部页笔迹
  const [penOn, setPenOn] = useState(false)
  const [penColor, setPenColor] = useState<string>(PEN_COLORS[0])
  const [penWidth, setPenWidth] = useState<number>(PEN_WIDTHS[0])
  const [annos, setAnnos] = useState<AnnoDoc>({})

  const engineRef = useRef<PdfEngine | null>(null)
  const docRef = useRef<PdfDocument | null>(null)
  /** 在飞的渲染任务：同一时刻只准一件——两块画布绝不能被并发写 */
  const inflightRef = useRef<Job | null>(null)
  /** 排队中的下一件（连点只保留最新一件） */
  const queuedRef = useRef<Job | null>(null)
  const runJobRef = useRef<(job: Job) => void>(() => {})
  const pageRef = useRef(1)
  const zoomRef = useRef(1)
  const pinchRef = useRef<Pinch | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const drawingRef = useRef(false)
  const strokePtsRef = useRef<[number, number][]>([])
  /** 起笔待落点：touchstart 记下原始触点，rect 取到当次值后才成笔 */
  const strokeSeedRef = useRef<{ x: number; y: number } | null>(null)
  const overlayCtxRef = useRef<CanvasCtx | null>(null)
  const overlayRectRef = useRef<{ left: number; top: number } | null>(null)
  const fileUrlRef = useRef('')
  /** 已落到画布上的 zoom；与 zoom 不等时说明还在等合并渲染 */
  const renderedZoomRef = useRef(1)
  /** 当前页高宽比：缩放时先按它换算内容尺寸，免去一次 getPageInfo */
  const aspectRef = useRef(0)
  const viewSizeRef = useRef(viewSize)
  /** 视口在屏幕上的位置：双指锚点换算要用它把 clientX/Y 变成视口内坐标 */
  const stageRectRef = useRef({ left: 0, top: 0 })
  /** 显示中的那块。只能在换帧处「同步」赋值——串行队列的下一件会立刻读它挑块，
      改成 effect 镜像的话读到的还是上一帧的值，就会渲到正在显示的画布上（清屏） */
  const activeLayerRef = useRef<Layer>('a')
  /** 在飞任务正写着的那一块 */
  const renderLayerRef = useRef<Layer | null>(null)
  /** 当前文档的字节：白帧自愈要重开文档，不再回网络/磁盘拿一次 */
  const bytesRef = useRef<ArrayBuffer | null>(null)
  /** 重开文档的节流：同一页短时间内只重开一次，防死循环 */
  const reloadGuardRef = useRef<{ page: number; at: number } | null>(null)

  // —— 以下为真机排查「渲染内容丢失」的临时诊断，定位后应整体删除 ——
  /** 白帧重渲的记录：同一页/同一缩放重试到第几次（有上限，不会死循环） */
  const blankRetryRef = useRef<BlankRetry | null>(null)
  /** 渲出过内容的页：用来区分「坏帧」和「这页本来就空白」 */
  const inkPagesRef = useRef<Set<number>>(new Set())
  /** 指向 requestRender（doRender 的延迟探针要用，避免循环依赖） */
  const requestRef = useRef<(job: Job) => void>(() => {})
  const dbgRef = useRef<string[]>([])
  const [dbgLines, setDbgLines] = useState<string[]>([])
  const logDbg = useCallback((line: string) => {
    const next = [...dbgRef.current, line].slice(-DBG_MAX_LINES)
    dbgRef.current = next
    setDbgLines(next)
  }, [])
  const resetDbg = useCallback(() => {
    dbgRef.current = []
    setDbgLines([])
  }, [])
  /** 点一下把全部日志（最多 DBG_MAX_LINES 条）复制到剪贴板 */
  const copyDbg = useCallback(() => {
    const text = dbgRef.current.join('\n')
    if (!text) return
    void Taro.setClipboardData({ data: text }).then(() => {
      void Taro.showToast({ title: t('scoreReader.dbgCopied'), icon: 'none' })
    })
  }, [t])

  const statusText =
    stage === 'fetching'
      ? t('scoreReader.fetching')
      : stage === 'parsing'
        ? t('scoreReader.parsing')
        : stage === 'rendering'
          ? t('scoreReader.rendering')
          : stage === 'ready'
            ? t('scoreReader.ready')
            : stage === 'error'
              ? message
              : t('scoreReader.idle')

  useEffect(() => {
    viewSizeRef.current = viewSize
  }, [viewSize])
  // 异步渲完后要判「这页还是不是当前页」，故用 ref 读最新值
  useEffect(() => {
    pageRef.current = page
  }, [page])
  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  // 卸载销毁引擎与文档
  useEffect(() => {
    return () => {
      docRef.current?.destroy()
      engineRef.current?.destroy()
      docRef.current = null
      engineRef.current = null
    }
  }, [])

  // 进入文件时载入本地批注
  useEffect(() => {
    if (fileId) setAnnos(loadAnnoDoc(fileId))
  }, [fileId])

  // 视口尺寸与屏幕位置（批注工具条/报错条显隐都会改视口高度，故跟着重量）
  const measureStage = useCallback(() => {
    Taro.createSelectorQuery()
      .select('#reader-stage')
      .boundingClientRect((rect) => {
        const r = rect as unknown as {
          left?: number
          top?: number
          width?: number
          height?: number
        } | null
        if (!r) return
        if (r.left !== undefined && r.top !== undefined) {
          stageRectRef.current = { left: r.left, top: r.top }
        }
        if (r.width && r.width > 0) setContainerW(r.width)
        if (r.height && r.height > 0) setContainerH(r.height)
      })
      .exec()
  }, [])

  useEffect(() => {
    const timer = setTimeout(measureStage, 0)
    return () => clearTimeout(timer)
  }, [measureStage, penOn, stage])

  const queryCanvasNode = useCallback(
    (id: string): Promise<{ node: unknown; left: number; top: number }> =>
      new Promise((resolve, reject) => {
        Taro.createSelectorQuery()
          .select(id)
          .fields({ node: true, size: true, rect: true })
          .exec((res) => {
            const field = res?.[0]
            if (field?.node) {
              resolve({
                node: field.node,
                left: field.left ?? 0,
                top: field.top ?? 0,
              })
            } else reject(new Error(t('scoreReader.notFound')))
          })
      }),
    [t]
  )

  /**
   * 用同一份字节重建引擎与文档。用于白帧自愈：pdf.js 内部有一层按页缓存
   * （算子列表 / 已解码图像），一旦某页被清空，之后每次重渲都只画底色——
   * 实测规律是「渲过的页、往前翻再翻回来就永远加载不出」。封装层没有暴露
   * 单页复位接口，重开文档是唯一能确定复位的手段。
   */
  const reloadDoc = useCallback(async () => {
    try {
      let bytes = bytesRef.current
      // 原字节可能已被 pdf.js 转移走（detach 后 byteLength 为 0）：重新取一份
      if (!bytes || bytes.byteLength === 0) {
        const target = fileUrlRef.current
        if (!target) return
        bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
          Taro.request({
            url: target,
            method: 'GET',
            responseType: 'arraybuffer',
            timeout: 60000,
            success: (res) => {
              if (res.statusCode === 200) resolve(res.data as ArrayBuffer)
              else reject(new Error(`HTTP ${res.statusCode}`))
            },
            fail: (err) => reject(new Error(err.errMsg || 'request failed')),
          })
        })
        bytesRef.current = bytes
      }
      setStage('parsing')
      const engine = createPdfEngine()
      engineRef.current?.destroy()
      engineRef.current = engine
      const doc = await engine.open(bytes)
      docRef.current?.destroy()
      docRef.current = doc
      setPageCount(doc.pageCount)
      aspectRef.current = 0
      renderedZoomRef.current = 0 // 与当前 zoom 必然不等，强制重渲一次
      blankRetryRef.current = null
      setDocTick((tick) => tick + 1)
    } catch (err) {
      setStage('error')
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }, [])

  // 渲一页到备用块（绝不碰显示中的那块）。渲完先确认这一帧不是白的，再换帧
  const doRender = useCallback(
    async (job: Job) => {
      const doc = docRef.current
      if (!doc || containerW <= 0 || pageCount <= 0) return
      const target = clamp(job.page, 1, pageCount)
      const layer: Layer = activeLayerRef.current === 'a' ? 'b' : 'a'
      renderLayerRef.current = layer
      const firstPaint = viewSizeRef.current.w <= 0
      // 只在还没有任何一帧时进 rendering：后续重渲不动状态，避免提示条反复显隐
      if (firstPaint) setStage('rendering')
      const info = await doc.getPageInfo(target)
      const aspect = info.height / info.width
      const fit = containerW / info.width
      const scale = fit * job.zoom
      const w = Math.max(1, Math.round(info.width * scale))
      const h = Math.max(1, Math.round(info.height * scale))
      const dpr = rasterDpr(w, h)
      logDbg(`r p${target} z${job.zoom} ${layer} ${Math.round(w * dpr)}x${Math.round(h * dpr)}`)
      // 首帧：先把内容尺寸给出来，别让画布以 0 高存在
      if (firstPaint) setViewSize({ w, h })
      const { node } = await queryCanvasNode(
        layer === 'a' ? '#reader-canvas-a' : '#reader-canvas-b'
      )
      drawMark(node as CanvasNode)
      await doc.renderPage(target, node, { scale, pixelRatio: dpr })
      const kept = markKept(node as CanvasNode)
      // 白帧判定：绘图指令是异步落到原生侧的，第一次读到白要再等一拍复核
      let ink = frameInk(node as CanvasNode)
      if (ink === 0) {
        await sleep(PROBE_RECHECK_MS)
        ink = frameInk(node as CanvasNode)
      }
      if (ink === 0) {
        const prev = blankRetryRef.current
        const attempt = prev && prev.page === target && prev.zoom === job.zoom ? prev.n + 1 : 1
        const stillHere = () => pageRef.current === target && zoomRef.current === job.zoom
        if (!inkPagesRef.current.has(target)) {
          // 这一页还没渲出过内容：可能它本来就空白（谱子里夹的空白页），
          // 也可能第一次渲就坏了。复核一次再定，别把白页判成坏帧、也别放过坏帧
          if (attempt <= 1) {
            blankRetryRef.current = { page: target, zoom: job.zoom, n: attempt }
            logDbg(`p${target} blank-page 复核`)
            setTimeout(() => {
              if (stillHere()) requestRef.current({ page: target, zoom: job.zoom })
            }, BLANK_RETRY_MS)
            return
          }
          logDbg(`p${target} blank-page`) // 确认本来就空：照常换上去
        } else {
          blankRetryRef.current = { page: target, zoom: job.zoom, n: attempt }
          logDbg(
            `blank p${target} #${attempt} ${Math.round(w * dpr)}x${Math.round(h * dpr)} kept=${kept ? 1 : 0}`
          )
          // 记号还在 = 这次渲染根本没碰画布（多半是瞬时问题）→ 重试有意义。
          // 记号被盖掉 = 渲染跑了却只画了底色（pdf.js 那页的数据没了）→ 重试没用，
          // 直接重开文档复位；这一条是实测出来的（用户复现时重试次次皆白）
          if (kept && attempt <= BLANK_MAX_RETRY && stillHere()) {
            setTimeout(() => {
              // 到点了再看一眼：用户要是已经翻走，这次重试就没意义了
              if (stillHere()) requestRef.current({ page: target, zoom: job.zoom })
            }, BLANK_RETRY_MS * attempt)
            return
          }
          const g = reloadGuardRef.current
          if (
            stillHere() &&
            bytesRef.current &&
            (!g || g.page !== target || Date.now() - g.at > RELOAD_COOLDOWN_MS)
          ) {
            reloadGuardRef.current = { page: target, at: Date.now() }
            logDbg(`blank p${target} reload`)
            void reloadDoc()
            return
          }
          // 连重开文档都没救回来：宁可停在上一页，也不把白帧换上去
          logDbg(`blank p${target} give-up`)
          return
        }
      } else {
        inkPagesRef.current.add(target)
        blankRetryRef.current = null
      }
      // 换帧：只在这页仍是当前页时
      if (pageRef.current !== target || zoomRef.current !== job.zoom) return
      aspectRef.current = aspect
      // 尺寸等渲完再落地，旧帧不被提前拉伸
      setViewSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
      renderedZoomRef.current = job.zoom
      // 必须同步写 ref：串行队列里下一件是在这次换帧的同一个同步块里启动的，
      // 它靠这个 ref 挑「反面那块」——晚一步（等 effect）它就会渲到正在显示的画布上
      activeLayerRef.current = layer
      setActiveLayer(layer)
      setStage('ready')
      logDbg(`swap p${target} ${layer} ink=${ink}`)
    },
    [containerW, logDbg, pageCount, queryCanvasNode, reloadDoc]
  )

  // 串行执行：一件渲完才起下一件。并发渲同一块画布会互相清屏（pdf.js 的
  // renderPage 一上来就 canvas.width=…），这是「快速翻页白页」的根源
  const runJob = useCallback(
    (job: Job) => {
      void (async () => {
        inflightRef.current = job
        try {
          await doRender(job)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          logDbg(`err p${job.page} ${msg.slice(0, 40)}`)
          setStage('error')
          setMessage(msg)
        } finally {
          inflightRef.current = null
          renderLayerRef.current = null
          const next = queuedRef.current
          queuedRef.current = null
          if (next) runJobRef.current(next)
        }
      })()
    },
    [doRender, logDbg]
  )
  useEffect(() => {
    runJobRef.current = runJob
  }, [runJob])

  /** 请求渲染某页：在飞的正好是它就别重排（它的完成回调自己会判断换帧还是留作缓存） */
  const requestRender = useCallback(
    (job: Job) => {
      const f = inflightRef.current
      if (!f) {
        runJob(job)
        return
      }
      if (f.page === job.page && f.zoom === job.zoom) {
        queuedRef.current = null
        return
      }
      queuedRef.current = job
    },
    [runJob]
  )
  useEffect(() => {
    requestRef.current = requestRender
  }, [requestRender])

  /** 让画面追上当前 page/zoom */
  const syncView = useCallback(() => {
    // 视口还没量到就别发请求：这种请求会被在飞任务当成「同一件」吞掉
    if (docTick <= 0 || pageCount <= 0 || containerW <= 0) return
    requestRender({ page: clamp(page, 1, pageCount), zoom })
  }, [containerW, docTick, page, pageCount, requestRender, zoom])

  // 翻页 / 首帧 / 容器宽变化：立即
  useEffect(() => {
    syncView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docTick, page, containerW])

  // 缩放即时反馈：只换内容尺寸（旧帧被拉伸，清晰度靠随后的重渲补回来）
  useEffect(() => {
    if (docTick <= 0 || containerW <= 0) return
    const aspect = aspectRef.current
    if (aspect <= 0) return
    const w = Math.max(1, Math.round(containerW * zoom))
    const h = Math.max(1, Math.round(aspect * containerW * zoom))
    setViewSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
  }, [zoom, containerW, docTick])

  // 内容尺寸变了：位置重新钳制（缩放/翻页/转屏后不会拉出空白）
  useEffect(() => {
    setPan((prev) => clampPan(prev, viewSize.w, viewSize.h, containerW, containerH))
  }, [viewSize, containerW, containerH])

  // 缩放合并渲染：手势/连点期间不起渲染，停手后一次渲到位
  useEffect(() => {
    if (docTick <= 0) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const settle = () => {
      if (cancelled) return
      // 正在落笔：让位给手写，收笔后再渲（否则清屏会打断这一笔）
      if (drawingRef.current || strokeSeedRef.current) {
        timer = setTimeout(settle, RENDER_RETRY_MS)
        return
      }
      if (zoom === renderedZoomRef.current) return
      syncView()
    }
    timer = setTimeout(settle, ZOOM_SETTLE_MS)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [zoom, docTick, syncView])

  // 说明：备用画布退役后**不再**把位图缩到 1×1。曾经这么做是为了省显存，但
  // 「离屏状态下改位图尺寸」很可能就是白帧的来源（画布进入画不出东西的状态），
  // 换来的是「换帧完全无闪」还是值得的。省显存靠水位控制（见 rasterDpr）

  // 批注层重绘：翻页 / 缩放 / 笔迹变化时按当前页恢复
  const redrawOverlay = useCallback(async () => {
    if (viewSize.w <= 0 || viewSize.h <= 0 || pageCount <= 0) return
    // 手势中不重画：内容框被拉伸时位图跟着缩放即可，停手后由 gestureTick 补画
    if (pinchRef.current) return
    try {
      const { node, left, top } = await queryCanvasNode('#reader-overlay')
      const overlay = node as CanvasNode
      overlayRectRef.current = { left, top }
      const dpr = rasterDpr(viewSize.w, viewSize.h)
      overlay.width = Math.round(viewSize.w * dpr)
      overlay.height = Math.round(viewSize.h * dpr)
      const ctx = overlay.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, viewSize.w, viewSize.h)
      overlayCtxRef.current = ctx
      const strokes = annos[String(page)] ?? []
      strokes.forEach((s) => drawStrokeOn(ctx, s, viewSize.w, viewSize.h))
      // 正在画的那一笔：上面刚清过屏，补回来免得断成两截
      if (drawingRef.current && strokePtsRef.current.length > 0) {
        drawPolylineOn(ctx, strokePtsRef.current, penColor, penWidth, viewSize.w, viewSize.h)
      }
    } catch {
      // overlay 未就绪时静默，下次状态变化会重试
    }
  }, [annos, page, pageCount, penColor, penWidth, queryCanvasNode, viewSize])

  useEffect(() => {
    if (docTick > 0) void redrawOverlay()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docTick, page, viewSize, annos, gestureTick])

  const persist = useCallback(
    (next: AnnoDoc) => {
      setAnnos(next)
      if (fileId) saveAnnoDoc(fileId, next)
    },
    [fileId]
  )

  const load = useCallback(
    async (targetUrl?: string) => {
      let finalUrl = targetUrl || ''
      let cacheTag = ''
      resetDbg() // 换文件时日志清零
      inkPagesRef.current.clear() // 页码对应不同内容，白页判据也要重置
      setStage('fetching')
      setMessage('')
      try {
        if (fileId && !finalUrl) {
          const { data, error } = await supabase
            .from('sheet_music_files')
            .select('*')
            .eq('id', fileId)
            .maybeSingle()
          if (error) throw new Error(error.message)
          if (!data) throw new Error(t('scoreReader.notFound'))
          const fileMeta = data as SheetMusicFileRow
          finalUrl = supabase.storage.from('sheet-music').getPublicUrl(fileMeta.storage_path)
            .data.publicUrl
          cacheTag = pdfCacheTag(fileMeta)
          void Taro.setNavigationBarTitle({ title: fileMeta.file_name })
        }
        if (!finalUrl) throw new Error(t('scoreReader.loadFailed', { error: 'no url' }))
        fileUrlRef.current = finalUrl

        // 本地缓存优先：同一份谱子第二次打开不再走网络
        let bytes = fileId && cacheTag ? await readCachedPdf(fileId, cacheTag) : null
        if (!bytes) {
          bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
            Taro.request({
              url: finalUrl,
              method: 'GET',
              responseType: 'arraybuffer',
              timeout: 60000,
              success: (res) => {
                if (res.statusCode === 200) resolve(res.data as ArrayBuffer)
                else reject(new Error(`HTTP ${res.statusCode}`))
              },
              fail: (err) => reject(new Error(err.errMsg || 'request failed')),
            })
          })
          // 落盘不挡首帧；失败也无所谓
          if (fileId && cacheTag) writeCachedPdf(fileId, cacheTag, bytes)
        }
        bytesRef.current = bytes

        setStage('parsing')
        const engine = createPdfEngine()
        engineRef.current?.destroy()
        engineRef.current = engine
        const doc = await engine.open(bytes)
        docRef.current?.destroy()
        docRef.current = doc
        const total = doc.pageCount
        setPageCount(total)
        // 书签：上次读到哪页就回到哪页
        const saved = fileId ? Number(Taro.getStorageSync(lastPageKey(fileId))) : NaN
        setPage(Number.isFinite(saved) && saved >= 1 ? clamp(Math.round(saved), 1, total) : 1)
        setZoom(1)
        setPan({ x: 0, y: 0 })
        renderedZoomRef.current = 1
        aspectRef.current = 0
        setDocTick((tick) => tick + 1)

        // page_count 回填：仅 admin / score_manager（成员无 UPDATE 权限，RLS 会拒）
        if (
          fileId &&
          total > 0 &&
          (profile?.role === 'admin' || profile?.role === 'score_manager')
        ) {
          void supabase
            .from('sheet_music_files')
            .update({ page_count: total })
            .eq('id', fileId)
            .is('page_count', null)
        }
      } catch (err) {
        setStage('error')
        setMessage(err instanceof Error ? err.message : String(err))
      }
    },
    [fileId, profile?.role, resetDbg, t]
  )

  // 自动加载：带 file_id / url 参数进入时
  useEffect(() => {
    if (fileId || presetUrl) void load(presetUrl || undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clampPage = (n: number) => clamp(Math.round(n), 1, Math.max(pageCount, 1))

  const gotoPage = (n: number) => {
    if (pageCount <= 0) return
    cancelStroke()
    setPage(clampPage(n))
  }

  const commitPageInput = () => {
    setPageEditing(false)
    const raw = pageInput.trim()
    const n = Number(raw)
    if (!raw || pageCount <= 0 || !Number.isFinite(n)) {
      setPageInput(String(page))
      return
    }
    const target = clampPage(n)
    setPageInput(String(target))
    gotoPage(target)
  }

  // 页码回填：仅在非编辑态跟随（编辑中回写会把用户刚敲的数字冲掉）
  useEffect(() => {
    if (!pageEditing) setPageInput(String(page))
  }, [page, pageEditing])

  // 书签：翻到哪页就记哪页，下次进来接着读
  useEffect(() => {
    if (fileId && pageCount > 0) Taro.setStorageSync(lastPageKey(fileId), String(page))
  }, [fileId, page, pageCount])

  // 触点归一化：rect 与尺寸都取「当次」值，笔迹与画布不脱节
  const pointOf = (clientX: number, clientY: number): [number, number] => {
    const rect = overlayRectRef.current
    const { w, h } = viewSizeRef.current
    if (!rect || w <= 0 || h <= 0) return [0, 0]
    return [clamp((clientX - rect.left) / w, 0, 1), clamp((clientY - rect.top) / h, 0, 1)]
  }

  const cancelStroke = () => {
    drawingRef.current = false
    strokePtsRef.current = []
    strokeSeedRef.current = null
  }

  // 起笔：rect 必须当次现取（工具条显隐会挪动画布），取到之前不落笔——
  // 拿旧 rect 算出的首点会连出一条「从按钮到落笔处」的飞线
  const beginStroke = (touch: { clientX: number; clientY: number }) => {
    cancelStroke()
    strokeSeedRef.current = { x: touch.clientX, y: touch.clientY }
    void (async () => {
      try {
        const { left, top } = await queryCanvasNode('#reader-overlay')
        overlayRectRef.current = { left, top }
      } catch {
        cancelStroke()
        return
      }
      const seed = strokeSeedRef.current
      if (!seed) return // 手指已抬起或已转双指
      strokeSeedRef.current = null
      drawingRef.current = true
      strokePtsRef.current = [pointOf(seed.x, seed.y)]
    })()
  }

  const drawLiveSegment = (touch: { clientX: number; clientY: number }) => {
    const ctx = overlayCtxRef.current
    const pts = strokePtsRef.current
    if (!ctx) return
    const p = pointOf(touch.clientX, touch.clientY)
    const prev = pts[pts.length - 1]
    pts.push(p)
    if (!prev) return
    const { w, h } = viewSizeRef.current
    styleFor(ctx, penColor, penWidth, w)
    ctx.beginPath()
    ctx.moveTo(prev[0] * w, prev[1] * h)
    ctx.lineTo(p[0] * w, p[1] * h)
    ctx.stroke()
  }

  // 按钮缩放：以视口中心为锚（不然放大只会往右下长）
  const zoomAtCenter = (next: number) => {
    const s1 = clamp(next, ZOOM_MIN, ZOOM_MAX)
    const aspect = aspectRef.current
    if (aspect <= 0 || containerW <= 0 || containerH <= 0) {
      setZoom(s1)
      return
    }
    const k = s1 / zoom
    const cx = containerW / 2 - pan.x
    const cy = containerH / 2 - pan.y
    const w = Math.max(1, Math.round(containerW * s1))
    const h = Math.max(1, Math.round(aspect * containerW * s1))
    setZoom(s1)
    setPan(
      clampPan(
        { x: containerW / 2 - cx * k, y: containerH / 2 - cy * k },
        w,
        h,
        containerW,
        containerH
      )
    )
  }

  // 双指：以两指中点为锚缩放，中点自身的位移同时当平移（地图式手势）
  const onTouchStart = (e: ITouchEvent) => {
    if (e.touches.length >= 2) {
      cancelStroke()
      dragRef.current = null
      const [a, b] = e.touches
      if (!a || !b) return
      const [mx, my] = touchMid(e.touches)
      pinchRef.current = {
        dist: touchDist(e.touches),
        zoom,
        pan,
        midX: mx - stageRectRef.current.left,
        midY: my - stageRectRef.current.top,
      }
      return
    }
    const touch = e.touches[0]
    if (!touch || docTick <= 0) return
    if (penOn) {
      beginStroke(touch)
      return
    }
    dragRef.current = { tx: touch.clientX, ty: touch.clientY, x: pan.x, y: pan.y }
  }

  const onTouchMove = (e: ITouchEvent) => {
    if (drawingRef.current && e.touches.length === 1) {
      const touch = e.touches[0]
      if (touch) drawLiveSegment(touch)
      return
    }
    const g = pinchRef.current
    if (e.touches.length >= 2 && g && g.dist > 0) {
      // 比例按钳制后的 zoom 折算：顶到上下限时中点也不能漂
      const next = clamp((g.zoom * touchDist(e.touches)) / g.dist, ZOOM_MIN, ZOOM_MAX)
      const k = next / g.zoom
      const [mx, my] = touchMid(e.touches)
      const w = Math.max(1, Math.round(containerW * next))
      const h = Math.max(1, Math.round(aspectRef.current * containerW * next))
      setZoom(next)
      setPan(
        clampPan(
          {
            x: mx - stageRectRef.current.left - (g.midX - g.pan.x) * k,
            y: my - stageRectRef.current.top - (g.midY - g.pan.y) * k,
          },
          w,
          h,
          containerW,
          containerH
        )
      )
      return
    }
    const d = dragRef.current
    if (d && e.touches.length === 1) {
      const touch = e.touches[0]
      if (!touch) return
      setPan(
        clampPan(
          { x: d.x + (touch.clientX - d.tx), y: d.y + (touch.clientY - d.ty) },
          viewSize.w,
          viewSize.h,
          containerW,
          containerH
        )
      )
    }
  }

  const onTouchEnd = (e: ITouchEvent) => {
    if (e.touches.length === 0) {
      dragRef.current = null
      if (drawingRef.current) {
        drawingRef.current = false
        const pts = strokePtsRef.current
        strokePtsRef.current = []
        if (pts.length > 0) {
          const key = String(page)
          const stroke: AnnoStroke = { color: penColor, width: penWidth, points: pts }
          persist({ ...annos, [key]: [...(annos[key] ?? []), stroke] })
        }
      }
      strokeSeedRef.current = null
    }
    if (e.touches.length < 2 && pinchRef.current) {
      pinchRef.current = null
      setGestureTick((n) => n + 1)
    }
  }

  // 触摸被系统打断：丢弃这一笔，别让 drawingRef 挂着招来飞线
  const onTouchCancel = () => {
    cancelStroke()
    dragRef.current = null
    if (pinchRef.current) {
      pinchRef.current = null
      setGestureTick((n) => n + 1)
    }
  }

  const handleUndo = () => {
    const key = String(page)
    const cur = annos[key] ?? []
    if (cur.length === 0) return
    persist({ ...annos, [key]: cur.slice(0, -1) })
  }

  const handleClear = () => {
    persist({ ...annos, [String(page)]: [] })
  }

  const togglePen = () => {
    cancelStroke()
    dragRef.current = null
    setPenOn((on) => !on)
  }

  // 下载到本地并用微信原生文档查看器打开（showMenu 附带转发/用其他应用打开）
  const [nativeBusy, setNativeBusy] = useState(false)
  const openNative = async () => {
    if (nativeBusy) return
    // 只认 load() 成功后写入的真实文件 URL：曾经 fallback 到 url state（无 file_id
    // 进入时是 DEFAULT_URL dummy.pdf），load 失败时「原生打开」会下载到 dummy
    const target = fileUrlRef.current
    if (!target) {
      void Taro.showToast({ title: t('scoreReader.nativeNotReady'), icon: 'none' })
      return
    }
    setNativeBusy(true)
    try {
      // 有本地缓存就直接用它，省一次下载
      const cached = cachedPdfPath(fileId)
      if (cached) {
        try {
          await Taro.openDocument({ filePath: cached, showMenu: true })
          return
        } catch {
          // 缓存文件没了/打不开：走下面重新下载
        }
      }
      const res = await Taro.downloadFile({ url: target })
      if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`)
      await Taro.openDocument({ filePath: res.tempFilePath, showMenu: true })
    } catch (err) {
      void Taro.showToast({
        title: t('scoreReader.downloadFailed', {
          error: err instanceof Error ? err.message : String(err),
        }),
        icon: 'none',
      })
    } finally {
      setNativeBusy(false)
    }
  }

  const showUrlInput = !fileId
  const currentStrokes = annos[String(page)] ?? []
  const showStatusRow =
    viewSize.w <= 0 && (stage === 'fetching' || stage === 'parsing' || stage === 'rendering')
  const boxW = viewSize.w || containerW || 0
  const boxH = viewSize.h || 0

  return (
    <View className={`${darkClass} score-reader-page flex h-full min-h-0 flex-col bg-page-bg`}>
      {/* 状态栏：页码 / 缩放 / 批注开关 */}
      <View className='flex flex-row items-center justify-between border-b border-border bg-surface px-4 py-2'>
        <Text className='text-xs text-text-muted'>
          {pageCount > 0 ? t('scoreReader.pageOf', { page, total: pageCount }) : statusText}
        </Text>
        <View className='flex flex-row items-center'>
          <Text className='mr-3 text-xs text-text-muted'>{Math.round(zoom * 100)}%</Text>
          <View
            className='mr-2 rounded-full border border-border bg-card px-3 py-1'
            onClick={() => void openNative()}
          >
            <Text className='text-xs text-text-muted'>{t('scoreReader.openNative')}</Text>
          </View>
          <View
            className={`rounded-full border px-3 py-1 ${
              penOn ? 'border-primary bg-primary/10' : 'border-border bg-card'
            }`}
            onClick={togglePen}
          >
            <Text className={`text-xs ${penOn ? 'text-primary' : 'text-text-muted'}`}>
              {t('scoreReader.annotation')}
            </Text>
          </View>
        </View>
      </View>

      {stage === 'error' && message ? (
        <View className='px-4 py-2'>
          <Text className='text-xs text-danger'>{message}</Text>
        </View>
      ) : null}

      {/* 调试模式：URL 输入（无 file_id 进入时） */}
      {showUrlInput ? (
        <View className='px-4 pt-3'>
          <View className='overflow-hidden rounded-lg border border-border bg-card'>
            <Input
              className='h-10 w-full bg-transparent px-3 text-sm text-text'
              value={url}
              onInput={(e) => setUrl(e.detail.value)}
              placeholder={t('scoreReader.inputPlaceholder')}
            />
          </View>
          <View className='mt-3 flex justify-center'>
            <Button
              className='rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground'
              onClick={() => void load()}
              disabled={stage === 'fetching'}
            >
              {t('scoreReader.load')}
            </Button>
          </View>
        </View>
      ) : null}

      {/* 画布区：内容框的位置和尺寸全由手势算，不再用 scroll-view——
          这样双指才能锚定中点缩放、拖动中点即平移，单指在批注模式也不会被滚动抢走。
          触摸只挂在这一层：工具条/工具栏上的点击不该被当成起笔 */}
      <View
        id='reader-stage'
        className='relative flex-1 min-h-0 overflow-hidden'
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        <View
          className='absolute'
          style={{
            left: `${pan.x}px`,
            top: `${pan.y}px`,
            width: `${boxW}px`,
            height: `${boxH}px`,
          }}
        >
          {/* 双缓冲：显示的那块在 0 位，另一块停在视口外（仍是正常绘制的画布节点）。
              渲染永远进备用块，渲完再换帧，pdf.js 清屏那一下就不会露白 */}
          <Canvas
            type='2d'
            id='reader-canvas-a'
            className='absolute top-0 block bg-page-bg'
            style={{
              left: activeLayer === 'a' ? '0px' : OFFSCREEN,
              width: `${boxW}px`,
              height: `${boxH}px`,
            }}
          />
          <Canvas
            type='2d'
            id='reader-canvas-b'
            className='absolute top-0 block bg-page-bg'
            style={{
              left: activeLayer === 'b' ? '0px' : OFFSCREEN,
              width: `${boxW}px`,
              height: `${boxH}px`,
            }}
          />
          <Canvas
            type='2d'
            id='reader-overlay'
            className='absolute left-0 top-0 block'
            style={{ width: `${boxW}px`, height: `${boxH}px` }}
          />
        </View>
        {/* 临时诊断条：点一下复制全部日志（只显示最后几条，保留最近 100 条） */}
        {dbgLines.length > 0 ? (
          <View
            className='absolute left-0 top-0 z-10 bg-black px-1 py-0.5 opacity-70'
            onClick={copyDbg}
          >
            <Text className='block text-xs text-white'>{t('scoreReader.dbgCopyHint')}</Text>
            {dbgLines.slice(-DBG_SHOW_LINES).map((line, i) => (
              <Text key={i} className='block text-xs text-white'>
                {line}
              </Text>
            ))}
          </View>
        ) : null}
        {showStatusRow ? (
          <View className='absolute left-0 right-0 top-0 py-3 text-center'>
            <Text className='text-xs text-text-muted'>{statusText}</Text>
          </View>
        ) : null}
      </View>

      {/* 批注工具条（画笔开启时显示） */}
      {penOn ? (
        <AnnotationBar
          color={penColor}
          width={penWidth}
          canUndo={currentStrokes.length > 0}
          onColor={setPenColor}
          onWidth={setPenWidth}
          onUndo={handleUndo}
          onClear={handleClear}
        />
      ) : null}

      {/* 工具栏：翻页（< x/n > 紧贴页码两侧）/ 跳页 / 缩放 */}
      <View
        className='flex flex-row items-center justify-between border-t border-border bg-surface px-3 py-2'
        style={{ paddingBottom: 'calc(8px + env(safe-area-inset-bottom))' }}
      >
        <View className='flex flex-row items-center'>
          <Button
            className='rounded-full border border-border bg-card px-3.5 py-1 text-xs text-text'
            disabled={page <= 1}
            onClick={() => gotoPage(page - 1)}
          >
            {'<'}
          </Button>
          <View className='mx-2 flex flex-row items-center'>
            <View className='overflow-hidden rounded border border-border bg-card'>
              <Input
                className='h-8 w-12 bg-transparent text-center text-xs text-text'
                type='number'
                placeholder={t('scoreReader.pageJump')}
                value={pageCount > 0 ? pageInput : ''}
                onFocus={() => setPageEditing(true)}
                onInput={(e) => setPageInput(e.detail.value)}
                onBlur={commitPageInput}
                onConfirm={commitPageInput}
              />
            </View>
            <Text className='ml-1 text-xs text-text-muted'>/ {pageCount || '-'}</Text>
          </View>
          <Button
            className='rounded-full border border-border bg-card px-3.5 py-1 text-xs text-text'
            disabled={pageCount <= 0 || page >= pageCount}
            onClick={() => gotoPage(page + 1)}
          >
            {'>'}
          </Button>
        </View>
        <View className='flex flex-row items-center'>
          <Button
            className='mr-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-text'
            onClick={() => zoomAtCenter(zoom - 0.25)}
          >
            −
          </Button>
          <Button
            className='mr-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-text'
            onClick={() => {
              setZoom(1)
              setPan({ x: 0, y: 0 })
            }}
          >
            {t('scoreReader.zoomReset')}
          </Button>
          <Button
            className='rounded-full border border-border bg-card px-3 py-1 text-xs text-text'
            onClick={() => zoomAtCenter(zoom + 0.25)}
          >
            +
          </Button>
        </View>
      </View>
    </View>
  )
}
