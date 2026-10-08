import { useCallback, useEffect, useRef, useState } from 'react'
import Taro, { useDidShow, useRouter, useUnload } from '@tarojs/taro'
import { View, Canvas, Image, Input, Button, Text } from '@tarojs/components'
import type { ITouchEvent } from '@tarojs/components'
import { supabase } from '@/lib/supabase'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass, useThemeContext } from '@/context/theme-context'
import { AnnotationBar } from '@/components/score/AnnotationBar'
import { ReaderTutorial } from '@/components/score/ReaderTutorial'
// 顶栏图标（Lucide 系列，72×72 PNG；暗色用 -dark 变体）
import pencilLine from '@/assets/icons/pencil-line.png'
import pencilLineDark from '@/assets/icons/pencil-line-dark.png'
import openExternal from '@/assets/icons/square-arrow-out-up-right.png'
import openExternalDark from '@/assets/icons/square-arrow-out-up-right-dark.png'
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
import { drawMark, frameInk, markKept, rasterDpr, sampleEdgeColors } from './lib/raster'
import { clamp, clampPan, touchDist, touchMid } from './lib/geometry'
import {
  bandAt,
  penBarBottom,
  zoneFor,
  Z_BAND,
  Z_PAGE_BADGE,
  Z_STATUS,
  Z_TOOLBAR,
} from './lib/layout'
import { blockedByEdgeGuard, isTap, snapZoom, swipeDir, swipeMinPx } from './lib/gesture'
import { drawPolylineOn, drawStrokeOn, styleFor } from './lib/anno-draw'
import {
  cachedPdfPath,
  lastPageKey,
  pdfCacheTag,
  readCachedPdf,
  writeCachedPdf,
} from './lib/pdf-cache'
import {
  loadPageImage,
  loadPageImageWithRetry,
  paintPageImage,
  prefetchPageImage,
  resetPageImageStrategy,
  PAGE_IMAGE_RETRY_DELAYS_MS,
  type LoadedPageImage,
  type PageImageError,
} from './lib/page-image'
import {
  createPageTurn,
  turnDirFor,
  TURN_EASING,
  TURN_MS,
  type PageTurn,
  type TurnFrame,
} from './lib/page-turn'
import { createPrefetchPump, type PrefetchPump } from './lib/prefetch-pump'
import {
  ALL_LAYERS,
  frameForPage,
  missingNeighbor,
  neighborFrames,
  predrawFallback,
  predrawGo,
  spareLayer,
  PREDRAW_IDLE_MS,
  PREDRAW_WAIT_MS,
  type LayerMetas,
  type PredrawFrame,
} from './lib/predraw'
import { hasSeenReaderTutorial, markReaderTutorialSeen } from './lib/tutorial-seen'
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

/** 三块画布的节点 id（与 lib/types.ts 的 Layer 一一对应） */
const CANVAS_SEL: Record<Layer, string> = {
  a: '#reader-canvas-a',
  b: '#reader-canvas-b',
  c: '#reader-canvas-c',
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * 在飞的后台预绘制的控制块（见 `doPredraw`）：
 * - `cancelled` / `wait` + `fire`：交互任务一声令下就打断它（取图与等停靠都要能被打断，
 *   否则「冷页取图最长 30s」会把用户等着的那次翻页一起拖住）；
 * - `adopt`：用户正好翻到它正在准备的那一页 ⇒ 不取消，让它跑完直接换帧。
 */
type BgCtl = {
  cancelled: boolean
  adopt: boolean
  wait: Promise<void>
  fire: () => void
}

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
  const dark = useThemeContext().mode === 'dark'
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
  // 正在滑出的那一块（翻页动画）；null = 没动画
  const [turn, setTurn] = useState<TurnFrame | null>(null)
  // 页码输入框：编辑期间用本地文本，不被 page 的 clamp 回写打断
  const [pageInput, setPageInput] = useState('1')
  const [pageEditing, setPageEditing] = useState(false)
  // 双指手势结束计数：手势中批注层不重画，结束时补一次
  const [gestureTick, setGestureTick] = useState(0)
  // 控制菜单（顶栏 / 底栏 / 批注条）默认隐藏：沉浸式阅读，点谱面中间唤出
  const [menuOn, setMenuOn] = useState(false)
  // 工具条**实测**高度：灰带的高度与灰带的点击命中都取它。
  // 不写死常量——微信的系统字体大小会改工具条高度，写死就会让灰带与工具条错位。
  const [barH, setBarH] = useState({ top: 0, bottom: 0 })
  // 灰带的填充色 = 当前这页**页边**的纸色（采样见 lib/raster.ts 的 sampleEdgeColors）：
  // 菜单关着时屏幕看起来就是「整屏都是谱面」。null = 还没采样到 ⇒ 用 token 里的默认灰
  const [bandColor, setBandColor] = useState<{ top: string; bottom: string } | null>(null)
  // 首次使用教程（蒙层）：从未看过的人第一次进来自动展示，顶栏「?」可随时再唤
  const [tutorialOn, setTutorialOn] = useState(false)
  const tutorialShownRef = useRef(false)

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
  /** 页码变化时刻：turnMs（页码变化 → 换帧）的诊断基准 */
  const pageChangeAtRef = useRef(0)
  const pinchRef = useRef<Pinch | null>(null)
  const dragRef = useRef<Drag | null>(null)
  /**
   * 本段手势期间出现过 ≥2 指 ⇒ 作废 tap/swipe。
   * 必须有：双指进入时只是把 dragRef 清掉，若不立这个旗标，双指抬起最后一指
   * （touches 归零、changedTouches 是它）会被分类成一次**误翻页的点击**。
   * 只在 touches 归零时复位。
   */
  const multiTouchRef = useRef(false)
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
  /** 页图预热泵：以当前页为中心的窗口预热（见 lib/prefetch-pump.ts） */
  const prefetchPumpRef = useRef<PrefetchPump | null>(null)
  // —— 邻居帧 / 预绘制（见 lib/predraw.ts、doPredraw / promoteFrame）——
  /**
   * 每块画布「现在放着哪一页」的记账。**铁律**：决定要写某块位图的那一刻就把这一笔清掉，
   * 只有画成功（含白帧校验）才写回——留着过期的记账就是上错页。
   */
  const layerMetaRef = useRef<LayerMetas>({ a: null, b: null, c: null })
  /** 失效世代：每个 await 之后都要复核，变了就丢掉这次预绘制 */
  const predrawEpochRef = useRef(0)
  const predrawTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 在飞的后台预绘制（交互任务靠它让位 / 采纳） */
  const bgRef = useRef<BgCtl | null>(null)
  /** `containerW` 的同步镜像：帧的判据不能等 effect（晚一拍会把旧尺寸的帧当有效帧） */
  const containerWRef = useRef(0)
  /** 排下一次预绘制（doRender 尾段与 promoteFrame 都要调，用 ref 断开循环依赖） */
  const schedulePredrawRef = useRef<() => void>(() => {})

  /**
   * 让所有邻居帧作废（世代 +1，并打断在飞的那次）。触发点：视口宽变化、缩放、换册、
   * 白帧重开文档、页面销毁、回到前台——凡是「已经画好的帧尺寸对不上/内容来路不明」的事。
   */
  const invalidatePredraw = useCallback((why: string) => {
    const hasFrames = Boolean(
      layerMetaRef.current.a || layerMetaRef.current.b || layerMetaRef.current.c
    )
    if (!hasFrames && !bgRef.current && !predrawTimerRef.current) return
    predrawEpochRef.current += 1
    layerMetaRef.current = { a: null, b: null, c: null }
    const ctl = bgRef.current
    if (ctl) {
      ctl.cancelled = true
      ctl.fire()
    }
    if (predrawTimerRef.current) {
      clearTimeout(predrawTimerRef.current)
      predrawTimerRef.current = null
    }
    // eslint-disable-next-line no-console
    console.log('[score-reader] predraw invalidated', why)
  }, [])
  /** 翻页动画的状态机（见 lib/page-turn.ts）。onChange 就是 setTurn，故只在首次渲染建 */
  const turnRef = useRef<PageTurn | null>(null)
  if (!turnRef.current) turnRef.current = createPageTurn({ onChange: setTurn })
  /** 显示中的那一页：换帧时更新。用来判断这一帧到底「换没换页」——同一页的重渲
      （缩放、转屏、白帧自愈）不该滑出去再滑回来 */
  const displayedPageRef = useRef(0)
  // 退出页面即停泵、停动画、停预绘制——后台抓取/计时器不该在页面销毁后继续
  useUnload(() => {
    prefetchPumpRef.current?.stop()
    turnRef.current?.stop()
    if (predrawTimerRef.current) clearTimeout(predrawTimerRef.current)
    predrawTimerRef.current = null
    layerMetaRef.current = { a: null, b: null, c: null }
    const ctl = bgRef.current
    if (ctl) {
      ctl.cancelled = true
      ctl.fire()
    }
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

  /**
   * 状态提示：首帧真正落地之前**只有一个词**「加载中…」。
   *
   * 曾经按 下载中/解析中/渲染中 分三档，用户反馈（2026-10-08）「加载转完了还显示渲染中」——
   * 那三档对用户没有可操作的信息，只是把「还没出来」说了三遍，还容易被读成卡住。
   * 想分档诊断仍旧可以：console 里有 `render timings` 的分阶段耗时。
   */
  const statusText =
    stage === 'ready'
      ? t('scoreReader.ready')
      : stage === 'idle'
        ? t('scoreReader.idle')
        : stage === 'error'
          ? message
          : t('scoreReader.loading')

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

  /**
   * 写 zoom 的唯一入口。ref 必须**同步**写：effect 要晚一拍，而手势判定（「未放大」）
   * 与预绘制有效性判据都吃这个精度——「刚捏合完立刻单指滑动」否则会被判反。
   */
  const applyZoom = useCallback((v: number) => {
    zoomRef.current = v
    setZoom(v)
  }, [])

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

  // 首次教程：等**首帧出来**再展示（一进页面就盖住加载过程，用户看不到自己在等什么），
  // 此时菜单保持默认隐藏，教程讲的正是「点中间唤出菜单」
  useEffect(() => {
    if (stage !== 'ready' || tutorialShownRef.current) return
    tutorialShownRef.current = true
    if (!hasSeenReaderTutorial()) setTutorialOn(true)
  }, [stage])

  /** 关闭教程才写「已看过」：展示时就写死的话，被强杀的用户下次就再也见不到了 */
  const dismissTutorial = () => {
    markReaderTutorialSeen()
    setTutorialOn(false)
  }

  /**
   * 量视口、屏幕位置与工具条高度（报错条显隐会改视口高度，故跟着重量）。
   *
   * 工具条**始终挂载**（菜单关着时 `visibility: hidden`——布局盒子还在，量得到高度），
   * 所以灰带的视觉高度与点击命中永远等于真实工具条高度，系统字体调大也不会错位。
   */
  const measureStage = useCallback(() => {
    type Rect = { left?: number; top?: number; width?: number; height?: number } | null
    Taro.createSelectorQuery()
      .select('#reader-stage')
      .boundingClientRect()
      .select('#reader-topbar')
      .boundingClientRect()
      .select('#reader-bottombar')
      .boundingClientRect()
      .exec((res) => {
        const [stageRect, topBar, bottomBar] = (res ?? []) as Rect[]
        if (stageRect) {
          if (stageRect.left !== undefined && stageRect.top !== undefined) {
            stageRectRef.current = { left: stageRect.left, top: stageRect.top }
          }
          if (stageRect.width && stageRect.width > 0) setContainerW(stageRect.width)
          if (stageRect.height && stageRect.height > 0) setContainerH(stageRect.height)
        }
        const top = Math.round(topBar?.height ?? 0)
        const bottom = Math.round(bottomBar?.height ?? 0)
        if (top > 0 && bottom > 0) {
          setBarH((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }))
        }
      })
  }, [])

  // 转屏 / 分屏后重量（也顺带让预绘制的 containerW 失效，见 lib/predraw.ts）
  useEffect(() => {
    Taro.onWindowResize(measureStage)
    return () => Taro.offWindowResize(measureStage)
  }, [measureStage])

  // ⚠️ 依赖里**没有** penOn：批注工具条已改成悬浮层，不再改 #reader-stage 的 rect。
  // 留着它只会在每次切换批注时白跑一次量测，并因此多触发一次重渲。
  useEffect(() => {
    const timer = setTimeout(measureStage, 0)
    return () => clearTimeout(timer)
  }, [measureStage, stage])

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
   * 采样刚落地这一帧的**纸色**，给上下灰带当填充色（观感：整屏都是谱面）。
   *
   * 后台跑、失败就算了：它只是观感，绝不能影响渲染与翻页。采样点取**页边留白**
   * （见 lib/raster.ts），所以拿到的是「这张纸的底色」而不是谱面的平均色。
   */
  const sampleBandColor = useCallback(
    (layer: Layer) => {
      void (async () => {
        try {
          const { node } = await queryCanvasNode(CANVAS_SEL[layer])
          const c = sampleEdgeColors(node as CanvasNode)
          if (c) {
            setBandColor((prev) =>
              prev && prev.top === c.top && prev.bottom === c.bottom ? prev : c
            )
          }
        } catch {
          // 采不到就保持原色（默认灰带），不是错误
        }
      })()
    },
    [queryCanvasNode]
  )
  /** ref 转一手：promoteFrame 的依赖数组是空的（只用 ref），拿不到这个 useCallback */
  const sampleBandColorRef = useRef<(layer: Layer) => void>(() => {})
  useEffect(() => {
    sampleBandColorRef.current = sampleBandColor
  }, [sampleBandColor])

  /**
   * 用同一份字节重建引擎与文档。用于白帧自愈：pdf.js 内部有一层按页缓存
   * （算子列表 / 已解码图像），一旦某页被清空，之后每次重渲都只画底色——
   * 实测规律是「渲过的页、往前翻再翻回来就永远加载不出」。封装层没有暴露
   * 单页复位接口，重开文档是唯一能确定复位的手段。
   */
  const reloadDoc = useCallback(async () => {
    // 防御：文档都重开了，备用块上那一帧的来历也就不作数了
    invalidatePredraw('reloadDoc')
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
  }, [fileId, invalidatePredraw])

  // 渲一页到备用块（绝不碰显示中的那块）。渲完先确认这一帧不是白的，再换帧
  const doRender = useCallback(
    async (job: Job) => {
      const imageMode = imageModeRef.current
      const doc = docRef.current
      // 图片模式没有 doc（刻意不打开 PDF）；pdf 模式下没有 doc 就没法渲染
      if ((!doc && !imageMode) || containerW <= 0 || pageCount <= 0) return
      const target = clamp(job.page, 1, pageCount)
      // 写哪块：不是显示中的那块，且是「最该被写掉」的那块（远的先弃、同远时弃上一页保下一页）
      const layer = spareLayer(ALL_LAYERS, activeLayerRef.current, layerMetaRef.current, target)
      renderLayerRef.current = layer
      // 铁律：马上要写这块位图了（paintPageImage / pdf.js 都会先清屏重设位图），
      // 这块画布的记账必须当场作废——留着它就是**直接上错页**，比白页更坏
      layerMetaRef.current[layer] = null
      const firstPaint = viewSizeRef.current.w <= 0
      // 只在还没有任何一帧时进 rendering：后续重渲不动状态，避免提示条反复显隐
      if (firstPaint) setStage('rendering')
      const tStep = Date.now()
      // 两种模式都要画布节点（图片模式的 createImage 挂在它上面），提前取
      const { node } = await queryCanvasNode(CANVAS_SEL[layer])
      const nodeMs = Date.now() - tStep

      let pageImg: LoadedPageImage | null = null
      let info: { width: number; height: number }
      // 诊断：**这次取图之前**，预热泵是否已经抓到过这一页。它直接回答
      // 「预热过的页在 iOS 上到底算不算命中」——warm 却仍要 600ms，说明泵白干了
      const warm = imageMode ? (prefetchPumpRef.current?.isWarm(target) ?? false) : false
      if (imageMode) {
        // 图片模式：加载页图（**走小程序图片层，微信自带缓存**；不要换成
        // downloadFile —— 那个不走 HTTP 缓存，每次都是真下载）。尺寸直接取自图片对象
        try {
          // 带退避重试（失败后重试两次）：图片层在高并发/瞬时抖动下会当场拒绝，
          // 而这类拒绝多是"这一刻的"——退避一拍再来通常就好
          pageImg = await loadPageImageWithRetry(
            node as CanvasNode,
            pageImageUrls(fileUrlRef.current, target)
          )
        } catch (err) {
          // 这条路径的失败原本**只在屏幕上可见**（图片层 onerror 不带状态码，唯一的原因
          // 文案也只有这里能拿到）——真机出现「页图加载失败」时事后完全无法定性，补上这条。
          const e = err as PageImageError
          const urls = pageImageUrls(fileUrlRef.current, target)
          const hostOf = (u?: string) => (u ? u.replace(/^https?:\/\//, '').split('/')[0] : '')
          reportClientError({
            event: 'score_reader_page_image_failed',
            message: describeError(err),
            detail: {
              fileId,
              page: target,
              /** 0 = 反代那条腿、1 = 直连那条腿（哪条不通看它） */
              urlIndex: e.urlIndex ?? -1,
              host: hostOf(urls[e.urlIndex ?? 0]),
              /** 图片层 onerror 的原文（例如 url not in domain list） */
              imgErrMsg: e.errMsg ?? '',
              /** 取图前这一页有没有被预热到（预热过还失败 ⇒ 不是"没预热"的问题） */
              warm,
              /** 最后失败的是哪条路：image = 小程序图片层、file = downloadFile 兜底 */
              via: e.via ?? '',
              /** 两条路每一条的失败原因（图片层失败 vs 兜底也失败，事后必须分得开） */
              trace: e.trace ?? '',
              /** 这是第几次尝试之后才放弃（含首次；3 = 首次 + 两次重试都失败） */
              attempts: PAGE_IMAGE_RETRY_DELAYS_MS.length + 1,
            },
          })
          throw err
        }
        info = { width: pageImg.width, height: pageImg.height }
        // 翻页：把预热泵的窗口挪到这一页（泵自己负责「前 3 后 3 优先、再填 ±窗口」，
        // 并发按网络档位有界——见 lib/prefetch-pump.ts）
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
      // 目标块可能还在滑（上一次翻页的动画没走完）：等它停靠再动它。串行队列的下一件
      // 必然写「刚退役的那一块」，而清屏（pdf.js 的 canvas.width = …）落在滑行半路
      // 会当场露白。放在这里而不是开头，是为了让取图/解析与动画尾巴并行
      const pageTurn = turnRef.current
      while (pageTurn && pageTurn.frame()?.layer === layer) {
        await pageTurn.settle(layer)
      }
      drawMark(node as CanvasNode)
      const tRender = Date.now()
      if (imageMode && pageImg) {
        // 整页 JPEG → canvas（小程序原生解码）——「打开快」的来源就是这一步
        paintPageImage(node as CanvasNode, pageImg.img, Math.round(w * dpr), Math.round(h * dpr))
      } else {
        await doc!.renderPage(target, node, { scale, pixelRatio: dpr })
      }
      const renderMs = Date.now() - tRender
      // 这一帧画完了：顺手采一下这张纸的纸色，给灰带上色（后台、失败无所谓）
      sampleBandColorRef.current(layer)
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
      // 首帧必打；**每次翻页**都打（turnMs 就是「翻页 <150ms」那个指标，快了也要看得见）；
      // 同一页的重渲只在偏慢时打
      const isTurn =
        !firstPaint && displayedPageRef.current > 0 && displayedPageRef.current !== target
      if (firstPaint || isTurn || infoMs + renderMs > 300) {
        // eslint-disable-next-line no-console
        console.log('[score-reader] render timings', {
          infoMs,
          nodeMs,
          renderMs,
          probeMs,
          ink,
          kept,
          warm,
          // 走到这条日志就说明这次翻页**没命中**预绘制（命中会走 promote 那条日志）
          predraw: imageMode && isTurn ? 'miss' : 'off',
          turnMs: pageChangeAtRef.current ? Date.now() - pageChangeAtRef.current : -1,
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
      // 退役的那一块 = 刚才还在显示的那块。**必须在改写 activeLayerRef 之前取**，
      // 且它的记账不用动——记的就是「刚离开的这一页」，正好成为反方向的邻居帧
      const retiring: Layer = activeLayerRef.current
      const shown = displayedPageRef.current
      displayedPageRef.current = target
      // 必须同步写 ref：串行队列里下一件是在这次换帧的同一个同步块里启动的，
      // 它靠这个 ref 挑「该写哪块」——晚一步（等 effect）它就会渲到正在显示的画布上
      activeLayerRef.current = layer
      setActiveLayer(layer)
      // 记账：这块现在放着 target。**只有图片模式才记**——pdf.js 的帧可能是静默白帧，
      // 而白帧自愈只跑在前台路径上，存下来的帧没有兜底
      layerMetaRef.current[layer] = imageMode
        ? {
            page: target,
            zoom: job.zoom,
            containerW,
            layer,
            cssW: w,
            cssH: h,
            aspect,
            at: Date.now(),
          }
        : null
      // 翻页动画：方向跟着翻页方向走（往回翻就向右滑），该不该滑见 turnDirFor
      const dir = turnDirFor({ firstPaint, shown, target })
      if (dir !== null) turnRef.current?.begin(retiring, dir)
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
      // 换帧落地，趁空闲把「下一页」备进备用块（见 schedulePredraw）
      schedulePredrawRef.current()
    },
    [containerW, fileId, pageCount, queryCanvasNode, reloadDoc]
  )

  /**
   * 用邻居帧换帧（两个方向都能用）。**逐行照抄 doRender 尾段的顺序**
   * （尺寸落地 → 换帧 → 动画），一处都不能改。
   *
   * 为什么不进串行队列：`doRender` 要先拿到 `inflightRef` 那把锁才会被调用，队列里若压着
   * 别的东西，换帧就排到后面去了——而这里追求的就是「换帧不等队列」。它不写位图、
   * 不碰 settle，本来就不需要那把锁。
   */
  const promoteFrame = useCallback((f: PredrawFrame): boolean => {
    if (pageRef.current !== f.page || zoomRef.current !== f.zoom) return false
    if (f.containerW !== containerWRef.current) return false
    // 显示中的那块不算「帧」（同页重渲该走常规路径）
    if (f.layer === activeLayerRef.current) return false
    aspectRef.current = f.aspect
    setViewSize((prev) =>
      prev.w === f.cssW && prev.h === f.cssH ? prev : { w: f.cssW, h: f.cssH }
    )
    renderedZoomRef.current = f.zoom
    // 退役的那一块 = 刚才还在显示的那块。**它的记账不用动**：记的就是「刚离开的这一页」，
    // 正好成为反方向的邻居帧（这正是"两个方向都能 0ms"的来源）
    const retiring: Layer = activeLayerRef.current
    const shown = displayedPageRef.current
    displayedPageRef.current = f.page
    activeLayerRef.current = f.layer
    setActiveLayer(f.layer)
    const dir = turnDirFor({ firstPaint: false, shown, target: f.page })
    if (dir !== null) turnRef.current?.begin(retiring, dir)
    // 邻居帧换帧这条路上也补一次纸色采样（它不经过 doRender）
    sampleBandColorRef.current(f.layer)
    // eslint-disable-next-line no-console
    console.log('[score-reader] predraw promote', {
      page: f.page,
      predraw: 'hit',
      ageMs: Date.now() - f.at,
      turnMs: pageChangeAtRef.current ? Date.now() - pageChangeAtRef.current : -1,
    })
    setStage('ready')
    schedulePredrawRef.current()
    return true
  }, [])

  /**
   * 后台预绘制：把「缺的那个邻居」取图并画进备用块，全程不进关键路径。
   * 用户真翻到它时由 `requestRender` 直接换帧（promoteFrame），等待 ≈ 0。
   *
   * 只对图片模式生效：pdf.js 的单页成本是 JS 主线程解码，后台跑会把**正在读的那一页**
   * 一起冻住；而且它的白帧自愈要求「记号 + 探测 + 重开文档」整套走全才敢上屏。
   */
  const doPredraw = useCallback(
    async (job: Job, ctl: BgCtl) => {
      const t0 = Date.now()
      const target = clamp(job.page, 1, pageCount)
      const layer = spareLayer(ALL_LAYERS, activeLayerRef.current, layerMetaRef.current, target)
      const epoch = predrawEpochRef.current
      const stale = () => ctl.cancelled || epoch !== predrawEpochRef.current
      /**
       * 采纳失败（取图失败 / 白帧 / 被失效打断）时的兜底：把这一页交回常规路径。
       * 判据在 lib/predraw.ts 的 predrawFallback 里（**刻意不看 cancelled**，见那里的注释）。
       */
      const fallback = () => {
        const job2 = predrawFallback({
          adopt: ctl.adopt,
          target,
          zoom: job.zoom,
          currentPage: pageRef.current,
          currentZoom: zoomRef.current,
        })
        if (job2) queuedRef.current = job2
      }
      try {
        // 写位图前必须等这块停靠：它往往正是上一段翻页动画刚退役、还在滑的那一块。
        // 与取图一样要能被打断——否则交互任务会被它拖住（见 BgCtl）
        await Promise.race([turnRef.current?.settle(layer) ?? Promise.resolve(), ctl.wait])
        if (stale()) return fallback()
        const { node } = await queryCanvasNode(CANVAS_SEL[layer])
        if (stale()) return fallback()
        const img = await Promise.race([
          loadPageImage(node as CanvasNode, pageImageUrls(fileUrlRef.current, target)),
          ctl.wait.then(() => null),
        ])
        if (!img || stale()) return fallback()
        const cw = containerWRef.current
        const aspect = img.height / img.width
        const scale = (cw / img.width) * job.zoom
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const dpr = rasterDpr(w, h)
        // 与 doRender 同一条铁律：马上要写这块位图，这块的记账当场作废
        // （否则这一笔若没画成 / 被判白帧，旧的记账会继续冒充「有效帧」）
        layerMetaRef.current[layer] = null
        paintPageImage(node as CanvasNode, img.img, Math.round(w * dpr), Math.round(h * dpr))
        // 有墨校验：帧从画完到上屏之间隔着不确定时间（位图可能被系统回收），而图片模式
        // 没有白帧自愈 —— 只丢弃、不重试（误丢的代价只是这一页走常规路径 ~50ms）
        const ink = frameInk(node as CanvasNode)
        if (ink === 0) {
          // eslint-disable-next-line no-console
          console.warn('[score-reader] predraw dropped: blank frame', { page: target })
          return fallback()
        }
        const frame: PredrawFrame = {
          page: target,
          zoom: job.zoom,
          containerW: cw,
          layer,
          cssW: w,
          cssH: h,
          aspect,
          at: Date.now(),
        }
        layerMetaRef.current[layer] = frame
        const readyMs = Date.now() - t0
        if (readyMs > 300) {
          // eslint-disable-next-line no-console
          console.log('[score-reader] predraw ready', { page: target, readyMs, ink })
        }
        // 另一个邻居还缺着就接着排一次（至多两页，天然收敛；失败路径不会走到这里）
        const still = missingNeighbor(
          pageRef.current,
          pageCount,
          neighborFrames(layerMetaRef.current, activeLayerRef.current, {
            zoom: zoomRef.current,
            containerW: containerWRef.current,
          })
        )
        if (still !== null) schedulePredrawRef.current()
        // 用户已经翻到这一页了（requestRender 里标了 adopt）：顺手把帧换上；
        // 换不上（守卫拦了）就交回常规路径
        if (ctl.adopt && !promoteFrame(frame)) fallback()
      } catch (err) {
        // 后台任务无权改用户界面：只留一行日志，不 setStage、不 reportClientError
        // eslint-disable-next-line no-console
        console.log('[score-reader] predraw failed', describeError(err))
        return fallback()
      }
    },
    [pageCount, promoteFrame, queryCanvasNode]
  )

  /**
   * 排一次后台预绘制：换帧后等动画停稳（PREDRAW_IDLE_MS）再动备用块；
   * 还没预热到就先等（抢在预热泵前面发是对同一 URL 的重复请求），超了宽限就不等了。
   */
  const schedulePredraw = useCallback(() => {
    if (predrawTimerRef.current) clearTimeout(predrawTimerRef.current)
    const startedAt = Date.now()
    const tick = () => {
      predrawTimerRef.current = null
      // 目标 = 当前页缺的那个邻居（两个都备好了就什么都不用做）
      const target = missingNeighbor(
        pageRef.current,
        pageCount,
        neighborFrames(layerMetaRef.current, activeLayerRef.current, {
          zoom: zoomRef.current,
          containerW: containerWRef.current,
        })
      )
      const go = predrawGo({
        imageMode: imageModeRef.current,
        zoom: zoomRef.current,
        pinching: Boolean(pinchRef.current),
        animating: Boolean(turnRef.current?.frame()),
        queueBusy: Boolean(inflightRef.current || queuedRef.current),
        target,
        warm: target !== null && (prefetchPumpRef.current?.isWarm(target) ?? false),
        waitedMs: Date.now() - startedAt,
      })
      if (go === 'wait') {
        predrawTimerRef.current = setTimeout(tick, PREDRAW_WAIT_MS)
        return
      }
      if (go === 'skip' || target === null) return
      runJobRef.current({ page: target, zoom: zoomRef.current, bg: true })
    }
    predrawTimerRef.current = setTimeout(tick, PREDRAW_IDLE_MS)
  }, [pageCount])
  useEffect(() => {
    schedulePredrawRef.current = schedulePredraw
  }, [schedulePredraw])

  // 串行执行：一件渲完才起下一件。并发渲同一块画布会互相清屏（pdf.js 的
  // renderPage 一上来就 canvas.width=…），这是「快速翻页白页」的根源。
  // 后台预绘制（job.bg）也走这里：它借的是同一个「同一时刻只有一件在动画布」的不变量。
  const runJob = useCallback(
    (job: Job) => {
      void (async () => {
        inflightRef.current = job
        let ctl: BgCtl | null = null
        if (job.bg) {
          let fire: () => void = () => {}
          const wait = new Promise<void>((resolve) => {
            fire = resolve
          })
          ctl = { cancelled: false, adopt: false, wait, fire: () => fire() }
          bgRef.current = ctl
        }
        try {
          if (job.bg && ctl) await doPredraw(job, ctl)
          else await doRender(job)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          setStage('error')
          setMessage(msg)
        } finally {
          inflightRef.current = null
          renderLayerRef.current = null
          if (bgRef.current === ctl) bgRef.current = null
          const next = queuedRef.current
          queuedRef.current = null
          if (next) runJobRef.current(next)
        }
      })()
    },
    [doPredraw, doRender]
  )
  useEffect(() => {
    runJobRef.current = runJob
  }, [runJob])

  /**
   * 请求渲染某页。三档：
   * 1. 备用块上正好是这一页（预绘制命中）⇒ **不进队列**直接换帧——「翻页 <150ms」的来源；
   * 2. 在飞的是后台预绘制 ⇒ 同一页就采纳它（让它跑完换帧），否则让它让位；
   * 3. 其余：在飞的正好是它就别重排（它的完成回调自己会判断换帧还是留作缓存）。
   *
   * ⚠️ 第 2 档必须截在「同一件就吞掉」之前：否则「预绘制正在飞 N+1、用户正好翻到 N+1」
   * 会被当成重复请求吞掉，那一帧永远上不了屏。
   */
  const requestRender = useCallback(
    (job: Job) => {
      const f = inflightRef.current
      if (f?.bg && bgRef.current) {
        const ctl = bgRef.current
        // 只采纳**还活着**的那次预绘制：写进已被失效的 ctl 会让这次请求被一起吞掉
        // （那件任务随后必然被 stale() 拦下，请求却已经 return 出去 ⇒ 页码与画面脱节）
        if (!ctl.cancelled && f.page === job.page && f.zoom === job.zoom) {
          ctl.adopt = true
          return
        }
        ctl.cancelled = true
        ctl.fire() // 打断它在跑的停靠/取图，别让交互任务等
        queuedRef.current = job
        return
      }
      // 邻居帧里正好有这一页 ⇒ 直接换帧（向前、向后都一样，0 等待）
      const frames = neighborFrames(layerMetaRef.current, activeLayerRef.current, {
        zoom: job.zoom,
        containerW: containerWRef.current,
      })
      const hit = frameForPage(frames, job.page)
      if (hit) {
        predrawEpochRef.current += 1 // 顺手掐掉可能在飞的另一次预绘制
        // 没吃下（守卫拦了，例如页码/层已经变了）：退回常规路径，别让用户停在上一页
        if (promoteFrame(hit)) return
      }
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
    [promoteFrame, runJob]
  )
  useEffect(() => {
    requestRef.current = requestRender
  }, [requestRender])

  // 视口宽变化 ⇒ 预绘制的尺寸作废（同步镜像给判据用：晚了会把旧尺寸的帧当有效帧，换帧后被拉糊）
  useEffect(() => {
    containerWRef.current = containerW
    invalidatePredraw('containerW')
  }, [containerW, invalidatePredraw])

  // 缩放变化 ⇒ 预绘制的缩放作废（捏合期间每次 move 都会走到这，开销只是几次 ref 写）
  useEffect(() => {
    invalidatePredraw('zoom')
  }, [zoom, invalidatePredraw])

  // 回到前台：画布位图在前后台切换后是否还在没有实测证据，作废一次的代价只是
  // 「回前台后的第一次翻页走常规路径」，比上错页/上白页便宜得多
  useDidShow(() => invalidatePredraw('show'))

  /** 让画面追上当前 page/zoom */
  const syncView = useCallback(() => {
    // 视口还没量到就别发请求：这种请求会被在飞任务当成「同一件」吞掉
    if (docTick <= 0 || pageCount <= 0 || containerW <= 0) return
    requestRender({ page: clamp(page, 1, pageCount), zoom })
  }, [containerW, docTick, page, pageCount, requestRender, zoom])

  // 翻页 / 首帧 / 容器宽变化：立即
  useEffect(() => {
    // 预热优先带跟着**用户意图**走：页码一变就挪（不是等取图完成——那要 300–1600ms，
    // 连续翻页时优先带会被追着跑）。见 lib/prefetch-pump.ts
    if (pageCount > 0) prefetchPumpRef.current?.setCurrent(clamp(page, 1, pageCount))
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
      // 取图策略（图片层 / downloadFile 兜底）的判定也跟着复位：换册=换了网络场景，
      // 用户点「重试」=明确要求重来一次，两处都值得重新判一遍（见 page-image 的注释）
      resetPageImageStrategy()
      setBandColor(null) // 纸色也作废：新册第一帧采到之前，先退回默认灰带
      invalidatePredraw('load') // 换册：备用块上那一帧属于上一册，作废
      inkPagesRef.current.clear() // 页码对应不同内容，白页判据也要重置
      // 「显示中的页」作废：换册后的首帧不滑（换册前后页码可能撞上，靠它区分）。
      // 上一册那一段滑出不用管——它自己 200ms 内会停靠
      displayedPageRef.current = 0
      const tStart = Date.now()
      timingRef.current = { startedAt: tStart }
      setStage('fetching')
      setMessage('')
      try {
        if (fileId && !finalUrl && presetStoragePath && presetPageCount > 0) {
          // 快速路径：列表页已把元数据带来 —— 省掉整次查询（那是首帧最大的一项）
          finalUrl = supabase.storage.from('sheet-music').getPublicUrl(presetStoragePath)
            .data.publicUrl
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
          applyZoom(1)
          setPan({ x: 0, y: 0 })
          renderedZoomRef.current = 1
          aspectRef.current = 0
          // 页图预热泵：总页数已知就建。首帧仍走前台路径；泵由 doRender 的首个
          // setCurrent 启动——不与首帧抢带宽
          const pump = createPrefetchPump({
            total: imagePageTotal,
            urlsFor: (n) => pageImageUrls(fileUrlRef.current, n),
            // 预取跟着「哪条路能用」走：图片层坏了就改为下进本地记账（见 prefetchPageImage），
            // 否则前台每页都要在坏掉的图片层上白等一轮
            prefetchOne: prefetchPageImage,
          })
          prefetchPumpRef.current = pump
          // 并发固定串行（泵默认值；理由见 lib/prefetch-pump.ts 的 PREFETCH_PARALLEL：
          // 并发会和前台取图抢图片层的额度，真机上把前台那次取图挤失败过）
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
    [applyZoom, fileId, invalidatePredraw, presetFileName, presetPageCount, presetStoragePath, t]
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
    const target = clampPage(n)
    // turnMs（页码变化 → 换帧）的诊断基准，也是「翻页 <150ms」那个指标
    if (target !== pageRef.current) pageChangeAtRef.current = Date.now()
    setPage(target)
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
      applyZoom(s1)
      return
    }
    const k = s1 / zoom
    const cx = containerW / 2 - pan.x
    const cy = containerH / 2 - pan.y
    const w = Math.max(1, Math.round(containerW * s1))
    const h = Math.max(1, Math.round(aspect * containerW * s1))
    applyZoom(s1)
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
  /**
   * 抬手时分类：点击（分区 / 灰带）或滑动（翻页）。
   *
   * 为什么判定放在抬手、而不是滑动过程中：滑动中途做轴锁，一旦在起手抖动时判错，
   * 竖直滚谱会当场卡死且**无法挽回**（手指还在屏上）；而未放大时内容框不宽于视口，
   * 横滑造成的平移本来就是空操作，所以「移动阶段照常平移」没有任何可观察代价。
   */
  const resolveTouchEnd = (g: Drag, end?: { clientX: number; clientY: number }) => {
    if (isTap(g, Date.now())) {
      // 灰带优先：菜单关着时上下两条灰带**任意横向位置**都只开关菜单，永不翻页
      if (g.band) {
        setMenuOn((on) => !on)
        return
      }
      const zone = zoneFor(g.relX, containerW)
      if (zone === 'menu') {
        setMenuOn((on) => !on)
        return
      }
      if (!g.canTurn) return
      gotoPage(pageRef.current + (zone === 'next' ? 1 : -1))
      return
    }
    if (!g.canTurn || !end) return
    const dir = swipeDir(g, end.clientX, end.clientY, swipeMinPx(containerW))
    if (dir === 0) return
    if (blockedByEdgeGuard(g.relX, dir)) return
    // 回滚这次手势造成的平移：用户意图是翻页，不是把谱面挪走
    setPan(
      clampPan(
        { x: g.x, y: g.y },
        viewSizeRef.current.w,
        viewSizeRef.current.h,
        containerW,
        containerH
      )
    )
    gotoPage(pageRef.current + dir)
  }

  const onTouchStart = (e: ITouchEvent) => {
    if (e.touches.length >= 2) {
      multiTouchRef.current = true
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
    // 双指退化后剩下的那根手指：既不建拖动记录，也不参与点击判定
    if (multiTouchRef.current) return
    const touch = e.touches[0]
    if (!touch) return
    if (penOn) {
      beginStroke(touch)
      return
    }
    // ⚠️ 这里**不再**按 docTick <= 0 早退：菜单默认隐藏，文档还没加载出来时也得能
    // 点中间把菜单叫出来（否则无 file_id 的调试入口连菜单都打不开）
    const relX = touch.clientX - stageRectRef.current.left
    const relY = touch.clientY - stageRectRef.current.top
    dragRef.current = {
      tx: touch.clientX,
      ty: touch.clientY,
      x: pan.x,
      y: pan.y,
      relX,
      relY,
      startAt: Date.now(),
      maxMove: 0,
      // 灰带的点击规则跟着灰带的**可见性**走：放大后不画灰带，那里也就按普通分区处理
      band: zoomRef.current <= 1 ? bandAt(relY, containerH, barH.top, barH.bottom) : null,
      canTurn: docTick > 0 && pageCount > 0 && zoomRef.current <= 1,
    }
  }

  const onTouchMove = (e: ITouchEvent) => {
    if (drawingRef.current && e.touches.length === 1) {
      const touch = e.touches[0]
      if (touch) drawLiveSegment(touch)
      return
    }
    const g = pinchRef.current
    if (e.touches.length >= 2 && g && g.dist > 0) {
      // 比例按钳制后的 zoom 折算：顶到上下限时中点也不能漂。
      // 100% 处有「吸附」：raw 落在 1±band 内一律吸到 1，推过带子才真的开始缩放（见 snapZoom）
      const next = clamp(
        snapZoom(clamp((g.zoom * touchDist(e.touches)) / g.dist, ZOOM_MIN, ZOOM_MAX)),
        ZOOM_MIN,
        ZOOM_MAX
      )
      const k = next / g.zoom
      const [mx, my] = touchMid(e.touches)
      const w = Math.max(1, Math.round(containerW * next))
      const h = Math.max(1, Math.round(aspectRef.current * containerW * next))
      applyZoom(next)
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
      const dx = touch.clientX - d.tx
      const dy = touch.clientY - d.ty
      // 判 tap 用的是**整段位移的最大值**，不是末点（横滑出去再滑回来会骗人）
      d.maxMove = Math.max(d.maxMove, Math.abs(dx), Math.abs(dy))
      setPan(clampPan({ x: d.x + dx, y: d.y + dy }, viewSize.w, viewSize.h, containerW, containerH))
    }
  }

  const onTouchEnd = (e: ITouchEvent) => {
    if (e.touches.length === 0) {
      const g = dragRef.current
      dragRef.current = null
      const multi = multiTouchRef.current
      multiTouchRef.current = false
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
      // 分类只在「本段从单指开始、中途也没出现过第二指」时做（双指的残留手指会落在多指判定里）
      if (g && !multi) resolveTouchEnd(g, e.changedTouches[0])
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
    multiTouchRef.current = false
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
    multiTouchRef.current = false
    const next = !penOn
    setPenOn(next)
    // 进批注必须把菜单打开：顶栏的「批注」按钮是它唯一的出口，菜单关着就出不来了
    if (next) setMenuOn(true)
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
  /** 灰带只在「菜单关着 + 未放大」时画，见 JSX 里的注释（放大后会盖住谱面） */
  const showBands = !menuOn && zoom <= 1
  const currentStrokes = annos[String(page)] ?? []
  // 「还没画出一帧」就一直显示 —— 判据是**首帧真的换帧**（stage 到 ready），而不是
  // 「画布尺寸有没有值」：图片模式下 `setViewSize` 发生在绘制**之前**，按尺寸判会让
  // 提示在画面出来之前就消失（真机反馈：第一次「进度走完但没渲染出来」、第二次
  // 干脆不显示 —— 同一个成因）
  const showStatusRow = stage !== 'ready' && stage !== 'error'
  const boxW = viewSize.w || containerW || 0
  const boxH = viewSize.h || 0

  // 双缓冲两块的样式。活跃块在 0 位；**滑出中的那块**压在最上层向左/向右移出，
  // 新页在下面被露出来（换帧时新页早已渲好，不违反「宁停上一页也不上白帧」）。
  // 移出距离取「内容框宽 / 视口宽」里的较大者：缩小后内容比视口窄且居中，只移
  // 自己一个宽度会在左边留一条没盖住的旧页。transform 恒给具体值（不用 none）：
  // 「none → 具体值」的插值在部分 WebView 上不稳，会直接跳到终点
  const layerStyle = (l: Layer) => {
    const sliding = turn && turn.layer === l ? turn : null
    return {
      left: activeLayer === l || sliding ? '0px' : OFFSCREEN,
      width: `${boxW}px`,
      height: `${boxH}px`,
      zIndex: sliding ? 3 : 1,
      transform: sliding
        ? `translateX(${sliding.dir * Math.max(boxW, containerW)}px)`
        : 'translateX(0px)',
      transition: sliding ? `transform ${TURN_MS}ms ${TURN_EASING}` : 'none',
    }
  }

  return (
    <View
      className={`${darkClass} score-reader-page relative flex h-full min-h-0 flex-col bg-page-bg`}
    >
      {stage === 'error' && message ? (
        <View className='flex flex-row items-center justify-between px-4 py-2'>
          <Text className='flex-1 text-xs text-danger'>{message}</Text>
          {/* 弱网下页图可能加载超时（实测有卡 150 秒的）——给一个显式重试，
              否则用户只能退出重进。
              ⚠️ 要**做成按钮的样子**：原来是一条裸文字（text-primary），真机上没人看出它是可点的
              （用户反馈「没看到重试按钮」） */}
          <View
            className='ml-3 shrink-0 rounded-full border border-border bg-card px-3 py-1'
            onClick={() => void load()}
          >
            <Text className='text-xs text-text'>{t('scoreReader.retry')}</Text>
          </View>
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

      {/* 舞台容器：唯一的堆叠上下文边界。工具条是它的绝对定位子节点（悬浮在谱面之上），
          #reader-stage 占满它 —— 于是开关菜单时谱面的尺寸与位置完全不变。
          ⚠️ 容器**不设 z-index**：那会造出新的堆叠上下文，把画布的 1/2/3 关在里面，
          与工具条的 12 就比不了大小（层级见 lib/layout.ts） */}
      <View className='relative flex-1 min-h-0'>
        {/* 画布区：内容框的位置和尺寸全由手势算，不再用 scroll-view——
            这样双指才能锚定中点缩放、拖动中点即平移，单指在批注模式也不会被滚动抢走。
            触摸只挂在这一层：工具条/工具栏上的点击不该被当成起笔 */}
        <View
          id='reader-stage'
          className='absolute inset-0 overflow-hidden'
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
            {/* 三块画布：一块显示中、一块放着「下一页」（预绘制）、一块放着「上一页」
                （换帧后退役的那块，内容是刚离开的那页——免费）。渲染永远进「该写的那块」，
                渲完再换帧，pdf.js 清屏那一下就不会露白（见 lib/predraw.ts 与 layerStyle）。
                换帧时退役的那块被动画移到滑出位（见 lib/page-turn.ts） */}
            <Canvas
              type='2d'
              id='reader-canvas-a'
              className='absolute top-0 block bg-page-bg'
              style={layerStyle('a')}
            />
            <Canvas
              type='2d'
              id='reader-canvas-b'
              className='absolute top-0 block bg-page-bg'
              style={layerStyle('b')}
            />
            <Canvas
              type='2d'
              id='reader-canvas-c'
              className='absolute top-0 block bg-page-bg'
              style={layerStyle('c')}
            />
            {/* 批注层：压在静态页之上、滑出的旧页之下（旧页滑走时把这一页的笔迹一起露出来）。
                不靠 DOM 顺序——滑出的那块要盖过它，只能靠 z-index */}
            <Canvas
              type='2d'
              id='reader-overlay'
              className='absolute left-0 top-0 block'
              style={{ width: `${boxW}px`, height: `${boxH}px`, zIndex: 2 }}
            />

            {/* 页码徽标：贴在**内容框**（这张谱子）的右下角——跟着平移/缩放走，不是屏幕
                坐标（谱子被拖出屏幕时它也一起走）。
                − 纯 Text/View，**不引入任何原生组件**（底栏那个跳页 Input 是原生组件，
                  它在父级 visibility:hidden 下仍可能漏出来，别在这里重蹈覆辙）；
                − chip 沿用工具条按钮那套（bg-card + border），压在谱面上也读得清；
                − 菜单开着时也保留：它就是「我在第几页」的常驻提示（用户 2026-10-08 定）。 */}
            {pageCount > 0 ? (
              <View
                className='absolute bottom-2 right-2 rounded border border-border bg-card px-1.5 py-0.5'
                style={{ zIndex: Z_PAGE_BADGE }}
              >
                <Text className='text-xs text-text-muted'>
                  {t('scoreReader.pageOf', { page, total: pageCount })}
                </Text>
              </View>
            ) : null}
          </View>

          {/* 灰带：菜单关着**且未放大**时压在谱面上下沿，高度＝**实测**工具条高度
              （与工具条严格重合）。必须是 stage 的**子节点**且不挂任何事件：触摸冒泡进
              同一个状态机，于是灰带上的点击照常按「任意横向位置＝开关菜单」处理。
              填充色 = 当前页**页边**的纸色（采样见 sampleBandColor）：菜单关着时屏幕
              看起来就是「整屏都是谱面」，而不是「谱面上压了两条灰条」。还没采到色之前
              退回 token 的默认灰（bg-menu-band）。
              ⚠️ 放大（zoom > 1）后不画：那时用户在逐小节看细节，两条灰带会**盖住谱面**
              （真机反馈）；而放大状态下「点中间唤菜单」照样可用，不缺这条提示。 */}
          {showBands && barH.top > 0 ? (
            <View
              className='absolute left-0 right-0 top-0 bg-menu-band'
              style={{ height: `${barH.top}px`, zIndex: Z_BAND, backgroundColor: bandColor?.top }}
            />
          ) : null}
          {showBands && barH.bottom > 0 ? (
            <View
              className='absolute bottom-0 left-0 right-0 bg-menu-band'
              style={{
                height: `${barH.bottom}px`,
                zIndex: Z_BAND,
                backgroundColor: bandColor?.bottom,
              }}
            />
          ) : null}

          {showStatusRow ? (
            // 画布带了 z-index（见 layerStyle），这条提示得压过它们才看得见
            <View
              className='absolute left-0 right-0 top-0 py-3 text-center'
              style={{ zIndex: Z_STATUS }}
            >
              <Text className='text-xs text-text-muted'>{statusText}</Text>
            </View>
          ) : null}
        </View>

        {/* 顶栏（悬浮）：页码 / 缩放 / 原生打开 / 批注 / 教程。
            菜单关着时 visibility:hidden + pointer-events:none —— 隐藏但**保留布局盒子**
            （于是高度随时量得到），触摸则穿透到谱面。
            非批注时半透明灰底（谱面透出，示意菜单已打开），批注时回到不透明 */}
        <View
          id='reader-topbar'
          className={`absolute left-0 right-0 top-0 flex flex-row items-center justify-between border-b border-border px-4 py-2 ${
            penOn ? 'bg-surface' : 'bg-toolbar-translucent'
          }`}
          style={{
            zIndex: Z_TOOLBAR,
            visibility: menuOn ? 'visible' : 'hidden',
            pointerEvents: menuOn ? 'auto' : 'none',
          }}
        >
          <Text className='text-xs text-text-muted'>
            {pageCount > 0 ? t('scoreReader.pageOf', { page, total: pageCount }) : statusText}
          </Text>
          <View className='flex flex-row items-center'>
            <Text className='mr-3 text-xs text-text-muted'>{Math.round(zoom * 100)}%</Text>
            <View
              className='mr-2 flex flex-row items-center justify-center rounded-full border border-border bg-card px-2.5 py-1.5'
              ariaLabel={t('scoreReader.openNative')}
              onClick={() => void openNative()}
            >
              <Image
                src={dark ? openExternalDark : openExternal}
                style={{ width: '18px', height: '18px' }}
              />
            </View>
            <View
              className={`flex flex-row items-center justify-center rounded-full border px-2.5 py-1.5 ${
                penOn ? 'border-primary bg-primary/10' : 'border-border bg-card'
              }`}
              ariaLabel={t('scoreReader.annotation')}
              onClick={togglePen}
            >
              <Image
                src={dark ? pencilLineDark : pencilLine}
                style={{ width: '18px', height: '18px' }}
              />
            </View>
            {/* 教程入口：批注按钮右边的小问号，随时可再唤出用法说明 */}
            <View
              className='ml-2 flex flex-row items-center justify-center rounded-full border border-border bg-card'
              style={{ width: '32px', height: '32px' }}
              ariaLabel={t('scoreReader.tutorialOpen')}
              onClick={() => setTutorialOn(true)}
            >
              {/* 「?」是文字不是图标，墨色走 --color-icon-ink（与两张图标 PNG 的笔画色逐值相同） */}
              <Text className='text-sm text-icon-ink'>?</Text>
            </View>
          </View>
        </View>

        {/* 底栏（悬浮）：翻页（< x/n > 紧贴页码两侧）/ 跳页 / 缩放 */}
        <View
          id='reader-bottombar'
          className={`absolute bottom-0 left-0 right-0 flex flex-row items-center justify-between border-t border-border px-3 py-2 ${
            penOn ? 'bg-surface' : 'bg-toolbar-translucent'
          }`}
          style={{
            zIndex: Z_TOOLBAR,
            paddingBottom: 'calc(8px + env(safe-area-inset-bottom))',
            visibility: menuOn ? 'visible' : 'hidden',
            pointerEvents: menuOn ? 'auto' : 'none',
          }}
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
                {/* 菜单关着时**不挂载 `Input`**：`input` 是小程序的**原生组件**，由原生层
                    渲染，父级的 visibility:hidden 在 iOS 上盖不住它（真机反馈：菜单关着
                    仍能看到这个框/框里的数字）。关着时用同尺寸的空 View 占位——
                    `measureStage` 只取底栏的**高度**，所以灰带高度与点击命中不受影响。 */}
                {menuOn ? (
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
                ) : (
                  <View className='h-8 w-12' />
                )}
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
              // 以视口中心为锚回到 100%：已经在 100% 时这个换算正好是恒等（点它不该把谱面
              // 甩到上边界、顶到 header 底下——真机反馈的 bug）；放大时则是「围绕当前视线缩小」，
              // 而不是跳回页首
              onClick={() => zoomAtCenter(1)}
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

        {/* 批注工具条：悬浮在底栏之上（位置取底栏的**实测**高度——它已含安全区，不重复叠加） */}
        {penOn ? (
          <View
            className='absolute left-0 right-0'
            style={{ bottom: penBarBottom(barH.bottom), zIndex: Z_TOOLBAR }}
          >
            <AnnotationBar
              color={penColor}
              width={penWidth}
              canUndo={currentStrokes.length > 0}
              onColor={setPenColor}
              onWidth={setPenWidth}
              onUndo={handleUndo}
              onClear={handleClear}
            />
          </View>
        ) : null}

        {/* 首次教程蒙层：放在最后 ⇒ 压在所有工具条之上（z 也最高）。
            它是 #reader-stage 的兄弟节点，触摸不会冒泡进舞台状态机 */}
        {tutorialOn ? <ReaderTutorial onClose={dismissTutorial} /> : null}
      </View>
    </View>
  )
}
