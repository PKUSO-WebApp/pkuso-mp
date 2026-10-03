import { useCallback, useEffect, useRef, useState } from 'react'
import Taro, { useRouter, useUnload } from '@tarojs/taro'
import { View, Canvas, Input, Button, Text } from '@tarojs/components'
import type { ITouchEvent } from '@tarojs/components'
import { supabase } from '@/lib/supabase'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import { AnnotationBar } from '@/components/score/AnnotationBar'
import {
  PEN_COLORS,
  PEN_WIDTHS,
  loadAnnoDoc,
  saveAnnoDoc,
  type AnnoDoc,
  type AnnoStroke,
} from '@/lib/annotation'
import { describeError, reportClientError } from '@/lib/error-report'
import { pageImageUrls } from '@/lib/score-page-image'
import { createPdfEngine, type PdfDocument, type PdfEngine } from '@vendor/wechat-miniprogram-pdf'
import type { SheetMusicFileRow } from '@/types/database'
// 页面内部模块：留在分包目录内，保证被打进分包 chunk（见 lib/types.ts 顶部注释）
import type {
  BlankRetry,
  CanvasCtx,
  CanvasNode,
  Drag,
  Job,
  Layer,
  Pan,
  Pinch,
  Stage,
} from './lib/types'
import { drawMark, frameInk, markKept, rasterDpr } from './lib/raster'
import { clamp, clampPan, touchDist, touchMid } from './lib/geometry'
import { drawPolylineOn, drawStrokeOn, styleFor } from './lib/anno-draw'
import {
  cachedPdfPath,
  lastPageKey,
  pdfCacheTag,
  readCachedPdf,
  writeCachedPdf,
} from './lib/pdf-cache'
import { loadPageImage, paintPageImage, type LoadedPageImage } from './lib/page-image'
import {
  createPrefetchPump,
  parallelForNetwork,
  type PrefetchPump,
} from './lib/prefetch-pump'
import './index.scss'

const DEFAULT_URL = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'
const ZOOM_MIN = 0.5
const ZOOM_MAX = 4
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
/** 备用帧停靠位置：移出视口即可（overflow:hidden 会裁掉），它仍是正常在绘制的画布 */
const OFFSCREEN = '-99999px'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * 探测 pdf 渲染依赖的环境能力（诊断用；一次调用开销可忽略）。
 *
 * 为什么需要：iOS 真机上 pdf.js 会「静默不画」——resolve、无异常，只有 console.warn。
 * 把环境事实随上报一起带回来，才能判断是缺 API（OffscreenCanvas / createImageBitmap）
 * 还是别的原因，而不用让测试者做真机调试。
 */
function probePdfEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    out.offscreenCtor = typeof (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas
  } catch {
    out.offscreenCtor = 'err'
  }
  try {
    const wxAny = Taro as unknown as {
      createOffscreenCanvas?: (o: { type: string; width: number; height: number }) => {
        getContext?: (t: string) => unknown
      } | null
    }
    const c = wxAny.createOffscreenCanvas?.({ type: '2d', width: 4, height: 4 })
    if (!c) out.wxOffscreen = 'null'
    else if (typeof c.getContext !== 'function') out.wxOffscreen = 'noGetContext'
    else {
      try {
        out.wxOffscreen = c.getContext('2d') ? 'ok' : 'nullCtx'
      } catch {
        out.wxOffscreen = 'ctxThrow'
      }
    }
  } catch {
    out.wxOffscreen = 'throw'
  }
  try {
    out.createImageBitmap = typeof (globalThis as { createImageBitmap?: unknown }).createImageBitmap
  } catch {
    out.createImageBitmap = 'err'
  }
  return out
}

export default function ScoreReader() {
  const { t } = useT()
  const darkClass = useThemeClass()
  useNavTitle('scoreReader.navTitle')
  const router = useRouter()
  const fileId = router.params.file_id ? decodeURIComponent(router.params.file_id) : ''
  const presetUrl = router.params.url ? decodeURIComponent(router.params.url) : ''
  // 列表页（pages/score-part）带过来的元数据：省掉一次走反代到境外库的查询
  //（实测 ~600ms）。缺了就回退查库——分享链接等旧入口不受影响。
  const presetStoragePath = router.params.sp ? decodeURIComponent(router.params.sp) : ''
  const presetPageCount = Number(router.params.pc) || 0
  const presetFileName = router.params.fn ? decodeURIComponent(router.params.fn) : ''

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
  /**
   * 图片模式：`page_count` 有值 = web 端上传时已预渲染页图（pkuso-web #378/#379）⇒
   * 逐页下载图片显示（原生解码，几十毫秒/页），不再下载/解析 PDF（那是 6 秒/页的
   * 纯 JS 解码路径）。NULL = 老文件或页图渲染失败 ⇒ 走 pdf.js 回退，功能完整但慢。
   */
  const imageModeRef = useRef(false)
  /** 页图预热泵：整册的「优先带 + 顺序补全」后台预热（见 lib/prefetch-pump.ts） */
  const prefetchPumpRef = useRef<PrefetchPump | null>(null)
  // 退出页面即停泵——后台抓取不该在页面销毁后继续
  useUnload(() => {
    prefetchPumpRef.current?.stop()
  })
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

  // —— 白帧自愈：不是临时诊断，是修复「渲染内容丢失」的常驻机制，别删 ——
  // 真机上 pdf.js 会 resolve 却什么都没画出来（整页白），只能靠渲前记号 + 渲后抽样
  // 探测（见 lib/raster.ts）发现，然后按情况重试渲染、或重开文档复位。
  /** 白帧重渲的记录：同一页/同一缩放重试到第几次（有上限，不会死循环） */
  const blankRetryRef = useRef<BlankRetry | null>(null)
  /** 渲出过内容的页：用来区分「坏帧」和「这页本来就空白」 */
  const inkPagesRef = useRef<Set<number>>(new Set())
  /** 指向 requestRender（doRender 的延迟探针要用，避免循环依赖） */
  const requestRef = useRef<(job: Job) => void>(() => {})
  // —— 诊断探针（定位 iOS 真机「打开全白」与「加载慢」）——
  // 白屏时页面逻辑是活的（顶栏能显示「1 / 34」），所以这些数据能随上报回传
  const consoleTailRef = useRef<string[]>([])
  const timingRef = useRef<Record<string, number | string | boolean>>({})

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

  // 采集 console 尾部：pdf.js 的失败只走 console.warn（不抛错），真机上没人看得到它，
  // 只保留最近若干条，随「首帧全白」的上报一起回传
  useEffect(() => {
    const tail: string[] = []
    consoleTailRef.current = tail
    const origWarn = console.warn
    const origError = console.error
    const push = (tag: string, args: unknown[]) => {
      try {
        const line =
          tag +
          args
            .map((a) => {
              if (typeof a === 'string') return a
              try {
                return JSON.stringify(a)
              } catch {
                return String(a)
              }
            })
            .join(' ')
            .slice(0, 240)
        tail.push(line)
        if (tail.length > 12) tail.shift()
      } catch {
        // 探针绝不能反过来影响业务
      }
    }
    console.warn = (...args: unknown[]) => {
      push('W|', args)
      origWarn(...(args as never[]))
    }
    console.error = (...args: unknown[]) => {
      push('E|', args)
      origError(...(args as never[]))
    }
    return () => {
      console.warn = origWarn
      console.error = origError
    }
  }, [])
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
      setMessage(describeError(err))
      // 这条自愈路径的重取字节走裸 Taro.request（绕过 taroFetch），失败只在屏幕上。
      // 白帧自愈多发生在弱网/大文件，正是最需要事后回溯的场景
      reportClientError({
        event: 'score_reader_reload_failed',
        message: describeError(err),
        detail: { fileId },
      })
    }
  }, [fileId])

  // 渲一页到备用块（绝不碰显示中的那块）。渲完先确认这一帧不是白的，再换帧
  const doRender = useCallback(
    async (job: Job) => {
      const imageMode = imageModeRef.current
      const doc = docRef.current
      // 图片模式没有 doc（刻意不打开 PDF）；pdf 模式下没有 doc 就没法渲染
      if ((!doc && !imageMode) || containerW <= 0 || pageCount <= 0) return
      const target = clamp(job.page, 1, pageCount)
      const layer: Layer = activeLayerRef.current === 'a' ? 'b' : 'a'
      renderLayerRef.current = layer
      const firstPaint = viewSizeRef.current.w <= 0
      // 只在还没有任何一帧时进 rendering：后续重渲不动状态，避免提示条反复显隐
      if (firstPaint) setStage('rendering')
      const tStep = Date.now()
      // 两种模式都要画布节点（图片模式的 createImage 挂在它上面），提前取
      const { node } = await queryCanvasNode(
        layer === 'a' ? '#reader-canvas-a' : '#reader-canvas-b'
      )
      const nodeMs = Date.now() - tStep

      let pageImg: LoadedPageImage | null = null
      let info: { width: number; height: number }
      if (imageMode) {
        // 图片模式：加载页图（**走小程序图片层，微信自带缓存**；不要换成
        // downloadFile —— 那个不走 HTTP 缓存，每次都是真下载）。尺寸直接取自图片对象
        pageImg = await loadPageImage(node as CanvasNode, pageImageUrls(fileUrlRef.current, target))
        info = { width: pageImg.width, height: pageImg.height }
        // 翻页：把预热泵的优先带挪到这一页（泵自己负责「先保后面 3 页、再顺序补全
        // 整册」，并发按网络档位有界——见 lib/prefetch-pump.ts）
        prefetchPumpRef.current?.setCurrent(target)
      } else {
        info = await doc!.getPageInfo(target)
      }
      const aspect = info.height / info.width
      const fit = containerW / info.width
      const scale = fit * job.zoom
      const w = Math.max(1, Math.round(info.width * scale))
      const h = Math.max(1, Math.round(info.height * scale))
      const dpr = rasterDpr(w, h)
      // 首帧：先把内容尺寸给出来，别让画布以 0 高存在
      if (firstPaint) setViewSize({ w, h })
      const infoMs = Date.now() - tStep - nodeMs
      drawMark(node as CanvasNode)
      const tRender = Date.now()
      if (imageMode && pageImg) {
        // 整页 JPEG → canvas（小程序原生解码）——「打开快」的来源就是这一步
        paintPageImage(node as CanvasNode, pageImg.img, Math.round(w * dpr), Math.round(h * dpr))
      } else {
        await doc!.renderPage(target, node, { scale, pixelRatio: dpr })
      }
      const renderMs = Date.now() - tRender
      const tProbe = Date.now()
      // 图片模式**不做**白帧探测：那套（渲前记号 + 渲后采样）是为 pdf.js 的**静默
      // 失败**设计的；页图是上传时预渲染的权威结果，不存在「渲染失败」。直接当有墨
      let kept = false
      let ink = 3
      if (!imageMode) {
        kept = markKept(node as CanvasNode)
        // 白帧判定：绘图指令是异步落到原生侧的，第一次读到白要再等一拍复核
        ink = frameInk(node as CanvasNode)
        if (ink === 0) {
          await sleep(PROBE_RECHECK_MS)
          ink = frameInk(node as CanvasNode)
        }
      }
      const probeMs = Date.now() - tProbe
      // 首帧必打；之后只在「这一页渲染/取图偏慢」时打——只打首帧的话翻页永远看不到
      if (firstPaint || infoMs + renderMs > 300) {
        // eslint-disable-next-line no-console
        console.log('[score-reader] render timings', {
          infoMs,
          nodeMs,
          renderMs,
          probeMs,
          ink,
          kept,
          containerW,
          scale: Number(scale.toFixed(3)),
          dpr,
          bitmapW: w * dpr,
          bitmapH: h * dpr,
        })
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
            setTimeout(() => {
              if (stillHere()) requestRef.current({ page: target, zoom: job.zoom })
            }, BLANK_RETRY_MS)
            return
          }
          // 确认本来就空：照常换上去
        } else {
          blankRetryRef.current = { page: target, zoom: job.zoom, n: attempt }
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
          // 图片模式没有「文档」可重开、也没有本地缓存可清：重试一次即可
          //（微信图片层会重拉那张图）
          if (imageMode && stillHere()) {
            const gi = reloadGuardRef.current
            if (!gi || gi.page !== target || Date.now() - gi.at > RELOAD_COOLDOWN_MS) {
              reloadGuardRef.current = { page: target, at: Date.now() }
              requestRef.current({ page: target, zoom: job.zoom })
              return
            }
          }
          const g = reloadGuardRef.current
          if (
            !imageMode &&
            stillHere() &&
            bytesRef.current &&
            (!g || g.page !== target || Date.now() - g.at > RELOAD_COOLDOWN_MS)
          ) {
            reloadGuardRef.current = { page: target, at: Date.now() }
            void reloadDoc()
            return
          }
          // 连重开文档都没救回来：宁可停在上一页，也不把白帧换上去
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
      if (firstPaint) {
        const startedAt = Number(timingRef.current.startedAt ?? 0)
        const timing = {
          ...timingRef.current,
          firstMs: startedAt ? Date.now() - startedAt : -1,
        }
        // 分阶段耗时：PC/工具端能在 console 里直接看到（「打开慢」靠它定位）
        // eslint-disable-next-line no-console
        console.log('[score-reader] first frame', { page: target, ink, kept, ...timing })
        if (ink <= 0) {
          // ink=0：首帧全白仍被换上去 = 渲染静默失败——正是 iOS 真机「打开全白」的表现
          // （顶栏有页码、画布什么都没有、pdf.js 不抛错）。
          // ink=-1：墨迹探测本身失败（getImageData 不可用/抛错，raster.ts 会吞成 -1），
          // 此时白帧判定整条链都失效，同样只在屏幕上可见。两种情况都只有这里能留痕；
          // 把 pdf.js 的 console 尾部与环境能力一起回传，免得依赖真机调试
          reportClientError({
            event: 'score_reader_blank_frame',
            message: `首帧未出墨 ink=${ink}`,
            detail: {
              fileId,
              page: target,
              kept,
              ...timing,
              env: probePdfEnv(),
              consoleTail: consoleTailRef.current.slice(-8),
            },
          })
        }
      }
      setStage('ready')
    },
    [containerW, fileId, pageCount, queryCanvasNode, reloadDoc]
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
    [doRender]
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
      let imagePageTotal = 0
      // 每次 load 都重置：ref 跨调用保留，上一次的图片模式不能让这一次（比如无
      // file_id 的 url 直开）误走图片路径
      imageModeRef.current = false
      prefetchPumpRef.current?.stop()
      prefetchPumpRef.current = null
      inkPagesRef.current.clear() // 页码对应不同内容，白页判据也要重置
      const tStart = Date.now()
      timingRef.current = { startedAt: tStart }
      setStage('fetching')
      setMessage('')
      try {
        if (fileId && !finalUrl && presetStoragePath && presetPageCount > 0) {
          // 快速路径：列表页已把元数据带来 —— 省掉整次查询（那是首帧最大的一项）
          finalUrl = supabase.storage.from('sheet-music').getPublicUrl(presetStoragePath).data
            .publicUrl
          imageModeRef.current = true
          imagePageTotal = presetPageCount
          if (presetFileName) void Taro.setNavigationBarTitle({ title: presetFileName })
        } else if (fileId && !finalUrl) {
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
          // 图片模式（pkuso-web #378/#379）：page_count 有值 = 上传时已预渲染页图 ⇒
          // 不下载 PDF、不解析，逐页下载图片显示（原生解码，几十毫秒/页）
          if (fileMeta.page_count && fileMeta.page_count > 0) {
            imageModeRef.current = true
            imagePageTotal = fileMeta.page_count
          } else {
            // 老文件 / 页图渲染失败的 ⇒ pdf.js 回退路径
            cacheTag = pdfCacheTag(fileMeta)
          }
          void Taro.setNavigationBarTitle({ title: fileMeta.file_name })
        }
        timingRef.current.metaMs = Date.now() - tStart
        if (!finalUrl) throw new Error(t('scoreReader.loadFailed', { error: 'no url' }))
        fileUrlRef.current = finalUrl

        if (imageModeRef.current) {
          // 图片模式：PDF 不下载、不解析——总页数来自库（page_count），首帧由 doRender 拉
          timingRef.current.cached = true
          setPageCount(imagePageTotal)
          const savedImg = fileId ? Number(Taro.getStorageSync(lastPageKey(fileId))) : NaN
          setPage(
            Number.isFinite(savedImg) && savedImg >= 1
              ? clamp(Math.round(savedImg), 1, imagePageTotal)
              : 1
          )
          setZoom(1)
          setPan({ x: 0, y: 0 })
          renderedZoomRef.current = 1
          aspectRef.current = 0
          // 页图预热泵：总页数已知就建。首帧仍走前台路径；泵由 doRender 的首个
          // setCurrent 启动——不与首帧抢带宽
          const pump = createPrefetchPump({
            total: imagePageTotal,
            urlsFor: (n) => pageImageUrls(fileUrlRef.current, n),
          })
          prefetchPumpRef.current = pump
          // 按网络档位放开并发（弱网保持串行：并发会和正在看的那一页抢带宽）
          void Taro.getNetworkType()
            .then(({ networkType }) => pump.setParallel(parallelForNetwork(networkType)))
            .catch(() => {})
          setDocTick((tick) => tick + 1)
          return
        }

        // 本地缓存优先：同一份谱子第二次打开不再走网络
        const tBytes = Date.now()
        let bytes = fileId && cacheTag ? await readCachedPdf(fileId, cacheTag) : null
        timingRef.current.cached = Boolean(bytes)
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
        timingRef.current.bytesMs = Date.now() - tBytes
        timingRef.current.size = bytes.byteLength
        bytesRef.current = bytes

        setStage('parsing')
        const tOpen = Date.now()
        const engine = createPdfEngine()
        engineRef.current?.destroy()
        engineRef.current = engine
        const doc = await engine.open(bytes)
        timingRef.current.openMs = Date.now() - tOpen
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

        // ⚠️ 这里曾回填 page_count（admin/score_manager 打开时写总页数）——**已删**。
        // 新语义下 page_count 是「页图就绪」的开关（pkuso-web #378）：回填会把没有
        // 页图的老文件标成「有页图」，阅读器进图片模式却找不到页图。总页数由 web 端
        // 在上传时（预渲染页图的那一次）写入——跨仓约定，别再回填。
      } catch (err) {
        setStage('error')
        setMessage(describeError(err))
        // 这条链路上有两类失败没有其它通道上报：下载字节走裸 Taro.request（绕过
        // taroFetch），pdf.js 解析/引擎错误则不经网络层——都只在用户屏幕上
        reportClientError({
          event: 'score_reader_load_failed',
          message: describeError(err),
          detail: { fileId },
        })
      }
    },
    [fileId, presetFileName, presetPageCount, presetStoragePath, t]
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
      const msg = describeError(err)
      // 下载走裸 Taro.downloadFile（绕过 taroFetch）：失败只在 toast 里闪一下，库里没有
      reportClientError({
        event: 'score_reader_native_open_failed',
        message: msg,
        detail: { fileId },
      })
      void Taro.showToast({
        title: t('scoreReader.downloadFailed', { error: msg }),
        icon: 'none',
      })
    } finally {
      setNativeBusy(false)
    }
  }

  const showUrlInput = !fileId
  const currentStrokes = annos[String(page)] ?? []
  // 「还没画出一帧」就一直显示 —— 判据是**首帧真的换帧**（stage 到 ready），而不是
  // 「画布尺寸有没有值」：图片模式下 `setViewSize` 发生在绘制**之前**，按尺寸判会让
  // 提示在画面出来之前就消失（真机反馈：第一次「进度走完但没渲染出来」、第二次
  // 干脆不显示 —— 同一个成因）
  const showStatusRow = stage !== 'ready' && stage !== 'error'
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
        <View className='flex flex-row items-center justify-between px-4 py-2'>
          <Text className='flex-1 text-xs text-danger'>{message}</Text>
          {/* 弱网下页图可能加载超时（实测有卡 150 秒的）——给一个显式重试，
              否则用户只能退出重进 */}
          <Text className='ml-3 shrink-0 text-xs text-primary' onClick={() => void load()}>
            {t('scoreReader.retry')}
          </Text>
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
