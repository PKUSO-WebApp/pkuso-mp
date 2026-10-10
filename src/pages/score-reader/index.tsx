import { useCallback, useEffect, useRef, useState } from 'react'
import Taro, { useDidShow, useRouter, useUnload } from '@tarojs/taro'
import { View, Canvas, Text } from '@tarojs/components'
import type { ITouchEvent } from '@tarojs/components'
import { supabase } from '@/lib/supabase'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass, useThemeContext } from '@/context/theme-context'
import { AnnotationBar } from '@/components/score/AnnotationBar'
import { ReaderToolbar, type ReaderPanel } from '@/components/score/ReaderToolbar'
import { ReaderTutorial } from '@/components/score/ReaderTutorial'
import { SaveToSheet } from '@/components/score/SaveToSheet'
import { usePdfHandoff } from '@/hooks/usePdfHandoff'
// 顶栏图标（Lucide 系列，72×72 PNG；暗色用 -dark 变体）
import {
  HIGHLIGHTER_ALPHA,
  PEN_COLORS,
  PEN_WIDTHS,
  effectiveWidth,
  loadAnnoDoc,
  saveAnnoDoc,
  type AnnoDoc,
  type AnnoStroke,
  type AnnoTool,
} from '@/lib/annotation'
import { markAnnoPending } from '@/lib/annotation-sync'
import {
  flushAnnotationSync,
  scheduleAnnotationSync,
  setAnnotationAdoptListener,
  syncAnnotationFile,
} from '@/lib/annotation-sync-runner'
import { describeError, reportClientError } from '@/lib/error-report'
import { pageImageUrls } from '@/lib/score-page-image'
import type { SheetMusicFileRow } from '@/types/database'
// 页面内部模块：留在分包目录内，保证被打进分包 chunk（见 lib/types.ts 顶部注释）
import type { CanvasCtx, CanvasNode, Drag, Job, Layer, Pan, Pinch, Stage } from './lib/types'
import { frameInk, rasterDpr, sampleEdgeColors } from './lib/raster'
import { clamp, clampPan, touchDist, touchMid } from './lib/geometry'
import { createPanQueue, type PanQueue } from './lib/pan-queue'
import {
  bandAt,
  penBarBottom,
  zoneFor,
  zoneOnAxis,
  ZONE_SPLITS_UD,
  Z_PAGE_BADGE,
  SAFE_BOTTOM,
  Z_STATUS,
  Z_TOOLBAR,
} from './lib/layout'
import { loadReaderMode, saveReaderMode, type ReaderMode } from './lib/reader-mode'
import {
  nextVisibleToRender,
  pageFromScroll,
  pageTop,
  pendingPages,
  stripHeight,
  stripViewport,
  visibleRange,
} from './lib/strip'
import { blockedByEdgeGuard, isTap, snapZoom, swipeDir, swipeMinPx } from './lib/gesture'
import { drawPolylineOn, drawStrokeOn, eraseStrokesAt } from './lib/anno-draw'
import { lastPageKey } from './lib/last-page'
import {
  isImageLayerBroken,
  loadPageImage,
  loadPageImageWithRetry,
  localFileFor,
  paintPageImage,
  prefetchPageImage,
  registerLocalFile,
  resetPageImageStrategy,
  PAGE_IMAGE_RETRY_DELAYS_MS,
  type LoadedPageImage,
  type PageImageError,
} from './lib/page-image'
import { loadAliveAlbum, pageFileStore, saveAlbum } from './lib/page-file-store'
import { isOnline, onReconnect } from './lib/net-status'
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
  spareLayerOffscreen,
  PREDRAW_IDLE_MS,
  PREDRAW_WAIT_MS,
  type LayerMetas,
  type PredrawFrame,
} from './lib/predraw'
import { hasSeenReaderTutorial, markReaderTutorialSeen } from './lib/tutorial-seen'
import './index.scss'

/** 橡皮擦的命中半径（CSS px）：手指划过的这条带子里的笔迹都会被整条删掉 */
const ERASER_RADIUS_PX = 14

const ZOOM_MIN = 0.5
const ZOOM_MAX = 4
/** 缩放合并窗口：停手满这么久才真正重渲（期间画布只换尺寸，不清屏） */
const ZOOM_SETTLE_MS = 180
/** 手写进行中推迟渲染的重试间隔 */
const RENDER_RETRY_MS = 140
/** 备用帧停靠位置：移出视口即可（overflow:hidden 会裁掉），它仍是正常在绘制的画布 */
const OFFSCREEN = '-99999px'

/** 三块画布的节点 id（与 lib/types.ts 的 Layer 一一对应） */
const CANVAS_SEL: Record<Layer, string> = {
  a: '#reader-canvas-a',
  b: '#reader-canvas-b',
  c: '#reader-canvas-c',
}

/** 批注画布：**每块页画布各一层**（跟着自己那一页走，见 strokeLayerRef 的注释） */
const CANVAS_OVERLAY_SEL: Record<Layer, string> = {
  a: '#reader-overlay-a',
  b: '#reader-overlay-b',
  c: '#reader-overlay-c',
}

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

/** 屏幕宽度（同步、恒定；取不到返回 0，由调用方兜底） */
function readScreenWidth(): number {
  try {
    return Taro.getWindowInfo?.()?.windowWidth ?? 0
  } catch {
    return 0
  }
}

export default function ScoreReader() {
  const { t } = useT()
  const darkClass = useThemeClass()
  const dark = useThemeContext().mode === 'dark'
  useNavTitle('scoreReader.navTitle')
  const router = useRouter()
  const fileId = router.params.file_id ? decodeURIComponent(router.params.file_id) : ''
  // 列表页（pages/score-part）带过来的元数据：省掉一次走反代到境外库的查询
  //（实测 ~600ms）。缺了就回退查库——分享链接等旧入口不受影响。
  const presetStoragePath = router.params.sp ? decodeURIComponent(router.params.sp) : ''
  const presetPageCount = Number(router.params.pc) || 0
  const presetFileName = router.params.fn ? decodeURIComponent(router.params.fn) : ''
  // 曲名与声部：**只**用于「保存到…」拼交付文件名（`{曲子}_{声部}_{文件名}.pdf`）。
  // 缺了不影响任何功能——拼不出来就退回 `{文件名}.pdf`（见 lib/pdf-save.ts 的 displayPdfName）。
  // 旧入口（早先分享出去的链接）没有这两个参数，属预期。
  const presetTitle = router.params.title ? decodeURIComponent(router.params.title) : ''
  const presetSection = router.params.sec ? decodeURIComponent(router.params.sec) : ''
  /** 文件字节数（库里 `file_size`）：只用它做分片下载的终止条件与长度校验 */
  const presetBytes = Number(router.params.sz) || 0

  const [stage, setStage] = useState<Stage>('idle')
  /** 这份谱子没有页图（预渲染失败 / 还没跑迁移）：不在 App 里渲染，只引导「保存到…」 */
  const [noImages, setNoImages] = useState(false)
  /**
   * 翻页模式：`lr` 左右翻页 / `ud` 上下滚动（见 lib/reader-mode.ts）。记住用户的选择。
   * 手势判定读的是 `modeRef`——那些回调要么依赖数组空、要么不想因模式重建。
   */
  const [mode, setMode] = useState<ReaderMode>(() => loadReaderMode())
  const modeRef = useRef<ReaderMode>(mode)
  useEffect(() => {
    modeRef.current = mode
  }, [mode])
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
  /**
   * `pan` 的**同步镜像**：手势里读「现在在哪」的地方（起手基准、捏合锚点、按钮缩放锚点、
   * 落笔判页）一律读它，别读渲染闭包里的 `pan`——平移合帧之后（见 lib/pan-queue.ts），
   * 闭包值最多能差出一帧的位移，表现为「接着滑时画面先往回跳一下」。
   * ⚠️ 所有平移写入都走下面几个口子；直接 setPan 会让镜像漂掉。
   */
  const panRef = useRef<Pan>(pan)
  const commitPan = useCallback((p: Pan) => {
    panRef.current = p
    setPan(p)
  }, [])
  /** 与镜像逐值相同就不落地：坐标对象每次都是新造的，按对象判不出「没动」 */
  const commitPanIfMoved = useCallback(
    (p: Pan) => {
      const cur = panRef.current
      if (p.x !== cur.x || p.y !== cur.y) commitPan(p)
    },
    [commitPan]
  )
  /**
   * 手势平移的**合帧队列**（见 lib/pan-queue.ts）：iOS 的 touchmove 几乎按屏幕刷新率直通，
   * 每个 move 一次 setData 会把「逻辑层 → 视图层」压满——真机表现就是「一次长滑还行，
   * 多次小幅滑动一顿一顿」（2026-10-09 iOS 反馈）。
   */
  const panQueueRef = useRef<PanQueue | null>(null)
  // commit 用 commitPanIfMoved：手势把平移钳住不动时（左右模式横滑——内容定死在居中位、
  // 竖条滚到两端）**一次渲染都不该发**，而那些恰恰是最常见的手势
  if (!panQueueRef.current) panQueueRef.current = createPanQueue({ commit: commitPanIfMoved })
  /** 手势中的平移：进队列（每帧最多落地一次，位置永远取最新） */
  const panTo = useCallback((p: Pan) => panQueueRef.current?.push(p), [])
  /** 把待落地的位移立刻补上：抬手 / 取消 / 读基准之前 */
  const flushPan = useCallback(() => panQueueRef.current?.flush(), [])
  // 双缓冲：显示帧在 a 或 b，渲染永远渲到另一块，渲完换帧
  const [activeLayer, setActiveLayer] = useState<Layer>('a')
  // 正在滑出的那一块（翻页动画）；null = 没动画
  const [turn, setTurn] = useState<TurnFrame | null>(null)
  // 页码输入框：编辑期间用本地文本，不被 page 的 clamp 回写打断
  // 双指手势结束计数：手势中批注层不重画，结束时补一次
  const [gestureTick, setGestureTick] = useState(0)
  // 控制菜单（顶栏 / 底栏 / 批注条）默认隐藏：沉浸式阅读，点谱面中间唤出
  const [menuOn, setMenuOn] = useState(false)
  // 工具条**实测**高度：灰带的高度与灰带的点击命中都取它。
  // 不写死常量——微信的系统字体大小会改工具条高度，写死就会让灰带与工具条错位。
  const [barH, setBarH] = useState({ top: 0, bottom: 0 })
  /**
   * 钳制与「这是第几页」要用的上下内缩：竖条模式 = 工具条实测高度，左右模式恒 0。
   *
   * 工具条悬浮在谱面之上、会盖住内容，所以「页顶对齐屏幕顶」这条判据要换成
   * 「页顶对齐**菜单栏下沿**」——否则跳到第 n 页时 n 的顶部就藏在菜单后面，滚到条首/条尾时
   * 第 1 页的顶与末页的底也永远露不出来（用户 2026-10-09 报）。见 lib/strip.ts 的 stripViewport。
   * 工具条关着时它的**布局盒子仍在**（visibility:hidden），高度照量 ⇒ 这条内缩与菜单开关无关，
   * 不然一开菜单页码/落点就跳一下。
   */
  const panInsets = useCallback(
    (): [number, number] => (modeRef.current === 'ud' ? [barH.top, barH.bottom] : [0, 0]),
    [barH.top, barH.bottom]
  )
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
  /**
   * 批注的同步镜像：**读-改-写**的调用点一律读它，不读 state。
   *
   * 云同步会从 React 之外把整份文档写进本地（别处改了同一册，落回本地时经
   * annotation-sync-runner 的 adopt 通路）。那一刻闭包里的 `annos` 可能还是旧的，拿它
   * 去 spread 再存，就把刚落地的内容覆盖回去了。渲染照旧读 state——要的就是重渲染。
   */
  const annosRef = useRef<AnnoDoc>({})
  /**
   * 当前工具：画笔 / 荧光笔 / 橡皮擦（橡皮擦按**整条**删除，见 eraseAtPoints + eraseStrokesAt）。
   * 三选一而不是两个布尔——「笔和擦同时开着」这种状态本来就不该存在。
   */
  const [tool, setTool] = useState<AnnoTool>('pen')
  /**
   * 真正落到笔迹上的线宽。粗细是**两支笔共用一份状态**的，而画笔画不出 16‰ 以上，
   * 所以从荧光笔切回画笔时按 8‰ 兜底（见 effectiveWidth）——落笔与实时笔迹都用它，
   * 免得「显示 8‰、画出来 32‰」。
   */
  const brushWidth = effectiveWidth(tool, penWidth)
  /**
   * 撤销栈：**一步 = 一次操作**（画一笔 / 擦掉若干笔），记该页「操作前」的笔迹。
   * 早先的撤销是「删掉当前页最后一笔」——有了橡皮擦就不能那样了：擦完再点撤销会删掉一笔
   * 用户根本没碰过的笔迹。栈只活在本次会话里（与从前一样，重进不保留）。
   */
  const historyRef = useRef<Array<{ page: number; before: AnnoStroke[] }>>([])
  const [undoDepth, setUndoDepth] = useState(0)

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
  /**
   * 这一笔落在**哪一页**、画进**哪一块**批注画布（落笔时定死，抬手时按它归档）。
   *
   * 批注层是**每块页画布各配一层**（`#reader-overlay-a|b|c`，跟着自己那一页的偏移走）：
   * 滚动时它跟着内容移动、完全不需要重画，所以不会闪；相邻页的笔迹也一起可见。
   * （早先是「一块视口大小的窗口画布 + 离散重锚」，重锚要清屏重画 ⇒ 真机上就是上下闪。）
   */
  const strokePageRef = useRef(0)
  const strokeLayerRef = useRef<Layer | null>(null)
  /** 橡皮擦：本段手势是否在擦、擦之前那页的笔迹（抬手时并成**一步**记进撤销栈） */
  const erasingRef = useRef(false)
  const erasedRef = useRef<AnnoStroke[] | null>(null)
  /**
   * 落擦的**待落点**与等待期间的触点（见 beginErase）：画布 rect 是异步取回的，取到之前
   * 一律不擦——拿着上一段手势的 rect 算坐标，擦掉的是别处的笔迹。
   */
  const eraseSeedRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const erasePendingRef = useRef<Array<{ clientX: number; clientY: number }>>([])
  const fileUrlRef = useRef('')
  /**
   * 页图本地记账的键：**与入口无关**（fileId + 页号）。绝不能用 URL 当键——`urls[0]` 是
   * 当前生效入口派生的，入口一次翻转（proxy → direct，且会持久化）就变，于是整册预下载
   * 下好的本地文件在第 0 档集体失联、泵又不会重下（已标记 attempted）⇒ 白重下整册。
   * 见 lib/page-image.ts 的 PageImageDeps.key（评审 2026-10-09 抓出）。
   */
  const pageFileKey = useCallback((n: number) => `${fileId}#${n}`, [fileId])
  /** 页图预热泵：以当前页为中心的窗口预热（见 lib/prefetch-pump.ts） */
  const prefetchPumpRef = useRef<PrefetchPump | null>(null)
  /**
   * 把**当前这一册**的本地文件记账落盘（跨会话复用，见 lib/page-file-store.ts）。
   * 换册时被下一册覆写，所以调用点（unload / 翻页防抖）不必自己记是哪一册。
   */
  const flushAlbumFiles = useRef<() => void>(() => {})
  // —— 邻居帧 / 预绘制（见 lib/predraw.ts、doPredraw / promoteFrame）——
  /**
   * 每块画布「现在放着哪一页」的记账。**铁律**：决定要写某块位图的那一刻就把这一笔清掉，
   * 只有画成功（预绘制那条路还要过「有墨校验」）才写回——留着过期的记账就是上错页。
   */
  const layerMetaRef = useRef<LayerMetas>({ a: null, b: null, c: null })
  /** 失效世代：每个 await 之后都要复核，变了就丢掉这次预绘制 */
  const predrawEpochRef = useRef(0)
  const predrawTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 在飞的后台预绘制（交互任务靠它让位 / 采纳） */
  const bgRef = useRef<BgCtl | null>(null)
  /**
   * 每块画布**此刻显示着哪一页**（竖条模式靠它摆位）。
   *
   * ⚠️ 与 `layerMetaRef`（语义记账：这块画布里是**哪一页的有效帧**，供换帧命中判断）**刻意分开**：
   * 渲染一件新页时要先把语义记账清掉（否则半成品会被当成有效帧换上去），但**摆位不能跟着清**
   * ——清了就当场离屏，用户正看着的那一页会凭空消失几百毫秒再回来，真机上就是「翻到下一页时
   * 上一页闪一下」。所以：语义记账随时可变，摆位只在**画成功**之后才更新。
   */
  const [layerSlot, setLayerSlot] = useState<Record<Layer, number | null>>({
    a: null,
    b: null,
    c: null,
  })

  // —— 竖条几何（上下滚动模式，见 lib/strip.ts）——
  // 一页的高 = 当前页在视口宽度下的高度；竖条总高 = 页高 × 页数。
  // `contentHRef` 供手势回调读：拖动/捏合/按钮缩放的钳制都要用**内容总高**（竖条模式下
  // 不是一页高），而那些回调不能依赖每次渲染重建。
  const ud = mode === 'ud'
  const pageH = viewSize.h
  const contentH = ud ? stripHeight(pageH, pageCount) : pageH
  const contentHRef = useRef(contentH)
  useEffect(() => {
    contentHRef.current = contentH
  }, [contentH])
  /** `containerW` 的同步镜像：帧的判据不能等 effect（晚一拍会把旧尺寸的帧当有效帧） */
  const containerWRef = useRef(0)
  /** 排下一次预绘制（doRender 尾段与 promoteFrame 都要调，用 ref 断开循环依赖） */
  const schedulePredrawRef = useRef<() => void>(() => {})
  /** 上下模式的滚动方向（1 = 往下滚）与上一次滚动位置：见「补渲染视口里的页」effect */
  const udDirRef = useRef<1 | -1>(1)
  const lastScrollRef = useRef(0)
  /** 批注写盘失败已上报过（每册每次会话一次）：存储满会一直失败，别刷表 */
  const annoSaveFailRef = useRef(false)
  /** 渲染队列排空的心跳（见 runJob 的 finally）：让「补渲染」有机会重看一眼视口 */
  const [idleTick, setIdleTick] = useState(0)
  /** 补渲染上一次请求的页 + 时刻：同一页 5 秒内不重复排（失败时别变成无限重试） */
  const fillLastRef = useRef<{ page: number; at: number } | null>(null)
  /** `layerSlot` 的同步镜像：后台写帧时要问「这块是不是正显示着视野内的页」 */
  const layerSlotRef = useRef<Record<Layer, number | null>>({ a: null, b: null, c: null })
  /** 当前视野盖到哪几页（闭区间；null = 尺寸还没量到）——判据与加载圈共用 visibleRange */
  const visibleRef = useRef<{ first: number; last: number } | null>(null)

  /**
   * 让所有邻居帧作废（世代 +1，并打断在飞的那次）。触发点：视口宽变化、缩放、换册、
   * 页面销毁、回到前台——凡是「已经画好的帧尺寸对不上/内容来路不明」的事。
   */
  const invalidatePredraw = useCallback((why: string) => {
    const hasFrames = Boolean(
      layerMetaRef.current.a || layerMetaRef.current.b || layerMetaRef.current.c
    )
    if (!hasFrames && !bgRef.current && !predrawTimerRef.current) return
    predrawEpochRef.current += 1
    layerMetaRef.current = { a: null, b: null, c: null }
    // ⚠️ 摆位记账**必须一起清**（2026-10-09 真机教训，见下面的注）：它同时是 UD 的
    // 「这块现在显示着哪一页」判据，留着它会让「像素已经换成别的页、摆位还说旧页」的错配
    // 一直摆在那儿——真机表现就是同一块位置反复闪出别的页（「第 4 页位置轮闪 1/2/3」）。
    setLayerSlot({ a: null, b: null, c: null })
    // 代价：UD 里三块画布会当场摆到屏外（可见判据=记账）⇒ 缩放/回前台那一瞬谱面是空的，
    // 直到新帧落地。所以**清完必须立刻补渲当前页**（见 useDidShow 那条与 zoom 的 settle 渲染）。
    // 正解是给「显示中」单独一份与帧有效性无关的记账，别再让两层共用一个——那是下一步。
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
      （缩放、转屏等同一页的重渲）不该滑出去再滑回来 */
  const displayedPageRef = useRef(0)
  /**
   * 取图来源计数：file = 预下载命中（该有的样子）、image = 图片层远端、download = 现下的兜底。
   * 与 `prefetchFailRef` 一起在**队列排空 / 退出页面**时上报一次（见 reportPageSource）——
   * 线上判读「用户到底遇到什么」就靠这一条：滑动中 image/download 占比高 = 预下载没铺到。
   */
  const viaTallyRef = useRef({ file: 0, image: 0, download: 0 })
  const prefetchFailRef = useRef(0)
  /** 这一册的总页数（上报要在回调里读，别让它进 useCallback 的依赖） */
  const totalPagesRef = useRef(0)
  const pageSourceSentRef = useRef(false)

  /**
   * 上报「这一册的取图来源 + 预下载失败数」。每册只报一次：正常读完一册时由泵的 onIdle
   * 触发，用户提前退出则由 useUnload 兜（那时请求可能发不出去，无所谓）。
   */
  const reportPageSource = useCallback(() => {
    if (pageSourceSentRef.current) return
    pageSourceSentRef.current = true
    const tally = viaTallyRef.current
    reportClientError({
      event: 'score_reader_page_source',
      message: `file ${tally.file} / image ${tally.image} / download ${tally.download} / prefetchFail ${prefetchFailRef.current}`,
      detail: {
        fileId,
        file: tally.file,
        image: tally.image,
        download: tally.download,
        prefetchFail: prefetchFailRef.current,
        pages: totalPagesRef.current,
        // 图片层被判坏 = 这台设备就是 2026-10-08 那类 iOS（它的失败会体现成 via=image）
        imageLayerBroken: isImageLayerBroken(),
      },
    })
  }, [fileId])

  // 退出页面即停泵、停动画、停预绘制——后台抓取/计时器不该在页面销毁后继续
  useUnload(() => {
    // 触发点 ②：把挂着的那次停笔防抖立刻发掉（最后一班车）。拿不到结果是有意的——
    // 页面正在卸载，请求发不发得出去都无所谓，欠账有联网恢复那条路兜
    if (fileId) flushAnnotationSync(fileId)
    prefetchPumpRef.current?.stop()
    // 离开页面前把这一册的本地记账落盘（这一册下次进册才可能整册命中）
    flushAlbumFiles.current()
    reportPageSource()
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
  /** 指向 requestRender（doRender 的延迟探针要用，避免循环依赖） */
  const requestRef = useRef<(job: Job) => void>(() => {})
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

  // 进入文件时载入本地批注，然后**先拉后推**地对一次账（触发点 ③）。
  // 这一次同时是「上次进程被杀、那一册的欠账没推上去」的兜底：欠账由指纹推导，不靠内存。
  useEffect(() => {
    if (!fileId) return
    const local = loadAnnoDoc(fileId)
    annosRef.current = local
    setAnnos(local)
    // 全量扫描（④⑤）可能在我们开着的时候把这一册的内容落回本地——那条路要走同一个镜像，
    // 否则画面停在旧内容上。这也是唯一需要「告诉阅读器」的通路：本册自己的同步拿得到返回值，
    // 但别处的扫描拿不到。
    setAnnotationAdoptListener((id, doc) => {
      if (id !== fileId) return
      annosRef.current = doc
      setAnnos(doc)
    })
    void syncAnnotationFile(fileId)
    return () => setAnnotationAdoptListener(null)
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
   * 切换翻页模式（底栏中间那个按钮）：左右 ↔ 上下。
   *
   * 一次要动四件事：① 记住选择；② `modeRef` 当帧就更新（手势判定读它）；③ 换布局后
   * 视图对准**当前页**（上下模式的条比一屏高得多，不滚过去就会看到第 1 页）；④ 作废
   * 邻居帧并重渲一次。最后弹一次**新模式**的教程——换模式等于换一套手势（用户 2026-10-08 定）。
   */
  const switchMode = () => {
    const next: ReaderMode = modeRef.current === 'ud' ? 'lr' : 'ud'
    modeRef.current = next
    setMode(next)
    saveReaderMode(next)
    cancelStroke()
    invalidatePredraw('mode')
    if (next === 'ud') scrollToPage(pageRef.current)
    setTutorialOn(true)
    syncView()
  }

  /**
   * 量视口、屏幕位置与底栏高度（报错条显隐会改视口高度，故跟着重量）。
   *
   * 底栏**始终挂载**（菜单关着时 `visibility: hidden`——布局盒子还在，量得到高度），
   * 所以内容内缩与「点下边缘唤菜单」的命中区永远等于真实底栏高度，系统字体调大也不会错位。
   *
   * ⚠️ **顶栏已去掉**（2026-10-10）：`barH.top` 因此恒为 0 —— 顶部不再有内缩，也不再
   * 有「点最上沿唤菜单」的命中区（上一条灰带随之消失）。别把 `top > 0` 当必要条件写回来：
   * 那会让 `barH` 永远不更新，内缩与命中区一起失效。
   */
  const measureStage = useCallback(() => {
    type Rect = { left?: number; top?: number; width?: number; height?: number } | null
    Taro.createSelectorQuery()
      .select('#reader-stage')
      .boundingClientRect()
      .select('#reader-bottombar')
      .boundingClientRect()
      .exec((res) => {
        const [stageRect, bottomBar] = (res ?? []) as Rect[]
        if (stageRect) {
          if (stageRect.left !== undefined && stageRect.top !== undefined) {
            stageRectRef.current = { left: stageRect.left, top: stageRect.top }
          }
          if (stageRect.width && stageRect.width > 0) setContainerW(stageRect.width)
          if (stageRect.height && stageRect.height > 0) setContainerH(stageRect.height)
        }
        const bottom = Math.round(bottomBar?.height ?? 0)
        if (bottom > 0) {
          setBarH((prev) => (prev.top === 0 && prev.bottom === bottom ? prev : { top: 0, bottom }))
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

  // 渲一页到备用块（绝不碰显示中的那块）。渲完直接换帧
  const doRender = useCallback(
    async (job: Job) => {
      if (containerW <= 0 || pageCount <= 0) return
      const target = clamp(job.page, 1, pageCount)
      // 写哪块：不是显示中的那块，且是「最该被写掉」的那块（远的先弃、同远时弃上一页保下一页）
      const layer = spareLayer(ALL_LAYERS, activeLayerRef.current, layerMetaRef.current, target)
      renderLayerRef.current = layer
      // 铁律：马上要写这块位图了（paintPageImage 一上来就重设 canvas 尺寸 = 清屏），
      // 这块画布的记账必须当场作废——留着它就是**直接上错页**，比白页更坏
      layerMetaRef.current[layer] = null
      const firstPaint = viewSizeRef.current.w <= 0
      // 只在还没有任何一帧时进 rendering：后续重渲不动状态，避免提示条反复显隐
      if (firstPaint) setStage('rendering')
      const tStep = Date.now()
      const { node } = await queryCanvasNode(CANVAS_SEL[layer])
      const nodeMs = Date.now() - tStep

      let pageImg: LoadedPageImage
      // 诊断：**这次取图之前**，预热泵是否已经抓到过这一页。它直接回答
      // 「预热过的页在 iOS 上到底算不算命中」——warm 却仍要 600ms，说明泵白干了
      const warm = prefetchPumpRef.current?.isWarm(target) ?? false
      try {
        // 页图走**小程序图片层**（微信自带 HTTP/磁盘图片缓存）；图片层在个别设备上会
        // 必现失败，那时自动退到 downloadFile 兜底并记住结论——见 lib/page-image.ts
        pageImg = await loadPageImageWithRetry(
          node as CanvasNode,
          pageImageUrls(fileUrlRef.current, target),
          { deps: { key: pageFileKey(target) } }
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
      const info = { width: pageImg.width, height: pageImg.height }
      // 翻页：把预热泵的窗口挪到这一页（泵自己负责「前 3 后 3 优先、再填 ±窗口」，
      // 并发按网络档位有界——见 lib/prefetch-pump.ts）
      prefetchPumpRef.current?.setCurrent(target)
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
      // 必然写「刚退役的那一块」，而清屏（paintPageImage 重设尺寸）落在滑行半路
      // 会当场露白。放在这里而不是开头，是为了让取图/解析与动画尾巴并行
      const pageTurn = turnRef.current
      while (pageTurn && pageTurn.frame()?.layer === layer) {
        await pageTurn.settle(layer)
      }
      const tRender = Date.now()
      // 整页 JPEG → canvas（小程序原生解码）——「打开快」的来源就是这一步
      paintPageImage(node as CanvasNode, pageImg.img, Math.round(w * dpr), Math.round(h * dpr))
      const renderMs = Date.now() - tRender
      // 这一帧画完了：顺手采一下这张纸的纸色，给灰带上色（后台、失败无所谓）
      sampleBandColorRef.current(layer)
      viaTallyRef.current[pageImg.via] += 1 // 取图来源计数（见 reportPageSource）
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
          // 这一张实际走的是哪一档：file = 预下载命中（**正常应有的值**）、
          // image = 图片层远端、download = 现下的兜底。整册预下载铺到位之后
          // 滑动中就不该再看到 image/download（见 lib/page-image.ts 的 LoadedPageImage）
          via: pageImg.via,
          warm,
          // 走到这条日志就说明这次翻页**没命中**预绘制（命中会走 promote 那条日志）
          predraw: isTurn ? 'miss' : 'off',
          turnMs: pageChangeAtRef.current ? Date.now() - pageChangeAtRef.current : -1,
          containerW,
          scale: Number(scale.toFixed(3)),
          dpr,
          bitmapW: w * dpr,
          bitmapH: h * dpr,
        })
      }
      // 换帧：只在这页仍是当前页时。
      // ⚠️ 但**位图已经写进这块画布了**（上面那次 paintPageImage），所以「丢弃」不等于
      // 「什么都没发生」：这块画布的**像素是 target、记账还是旧页**。UD 里三块画布都可见
      // 且都按记账摆位 ⇒ 屏幕上就是「某个页位反复闪出别的页」（真机 2026-10-09 报的
      // 「第 4 页位置轮闪 1/2/3」）。所以页过期时必须**立刻把真正的当前页补渲回来**，
      // 把错配窗口压到一次渲染之内（渲染队列是单槽最新优先，不会因此堆积）。
      // 只补「页过期」：缩放过期是捏合中的常态（每帧都变，补渲会变成每帧一次全页解码），
      // 那条由捏合结束后的合并重渲兜（见 zoom 的 settle 渲染）。
      if (pageRef.current !== target || zoomRef.current !== job.zoom) {
        if (pageRef.current !== target) {
          requestRef.current({ page: pageRef.current, zoom: zoomRef.current })
        }
        return
      }
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
      // 摆位跟着换帧走（见 layerSlot 的注释：它只在画成功之后更新）
      setLayerSlot((prev) => (prev[layer] === target ? prev : { ...prev, [layer]: target }))
      // 记账：这块现在放着 target（预绘制据此知道「哪个邻居已经备好」）
      layerMetaRef.current[layer] = {
        page: target,
        zoom: job.zoom,
        containerW,
        layer,
        cssW: w,
        cssH: h,
        aspect,
        at: Date.now(),
      }
      // 翻页动画：方向跟着翻页方向走（往回翻就向右滑），该不该滑见 turnDirFor。
      // ⚠️ 上下模式不做滑出动画——那里的「翻页」就是滚动本身，滑一下反而像故障
      const dir = modeRef.current === 'ud' ? null : turnDirFor({ firstPaint, shown, target })
      if (dir !== null) turnRef.current?.begin(retiring, dir)
      if (firstPaint) {
        const startedAt = Number(timingRef.current.startedAt ?? 0)
        // 分阶段耗时：PC/工具端能在 console 里直接看到（「打开慢」靠它定位）
        // eslint-disable-next-line no-console
        console.log('[score-reader] first frame', {
          page: target,
          firstMs: startedAt ? Date.now() - startedAt : -1,
          ...timingRef.current,
        })
      }
      setStage('ready')
      // 换帧落地，趁空闲把「下一页」备进备用块（见 schedulePredraw）
      schedulePredrawRef.current()
    },
    [containerW, fileId, pageCount, pageFileKey, queryCanvasNode]
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
    const dir =
      modeRef.current === 'ud' ? null : turnDirFor({ firstPaint: false, shown, target: f.page })
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
   * 预绘制只对「写位图」这条路成立：它的帧是整页 JPEG，画进备用块的成本是几毫秒，
   * 所以能放在后台；写的时候只碰备用块，绝不动正在显示的那一块。
   */
  const doPredraw = useCallback(
    async (job: Job, ctl: BgCtl) => {
      const t0 = Date.now()
      const target = clamp(job.page, 1, pageCount)
      // ⚠️ 后台写帧**只准写视野外的那块**（UD 里三块都可见，写视野内的块 = 当着用户的面
      // 换掉他正看着的内容 —— 真机 2026-10-09「内容跳来跳去/显出别的页」的成因之一）。
      // 返回 null = 没有可写的块（剩下的都在视野里）⇒ 这一次预绘制直接作罢，什么都不做：
      // 宁可这一页晚点备好，也不搅动正在读的页面。见 lib/predraw.ts 的 spareLayerOffscreen。
      const layer = spareLayerOffscreen(
        ALL_LAYERS,
        activeLayerRef.current,
        layerMetaRef.current,
        target,
        (l) => layerSlotRef.current[l],
        visibleRef.current
      )
      if (layer === null) return
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
          // ⚠️ `key` 必须传（与前台那条完全一致）：不传时 page-image 退化成拿 `urls[0]`
          // 当记账键，而整册预下载用的键是 `fileId#页号` ⇒ **即使整册已经在本地，预绘制也
          // 永远命不中第 0 档**、每次都要真走一次网络（先撞反代那道 Referer 门的 403，
          // 再换直连）。实测来源：2026-10-10 开发者工具 Network 里的那条 p5.jpg 403。
          loadPageImage(node as CanvasNode, pageImageUrls(fileUrlRef.current, target), {
            key: pageFileKey(target),
          }),
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
        // 没有自愈路径 —— 只丢弃、不重试（误丢的代价只是这一页走常规渲染 ~50ms）
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
        // 画成功了才更新**摆位**：这一块现在真的显示着 target 了，摆到它那一页的位置上
        setLayerSlot((prev) => (prev[layer] === target ? prev : { ...prev, [layer]: target }))
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
    [pageCount, promoteFrame, queryCanvasNode, pageFileKey]
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
      const busy = Boolean(inflightRef.current || queuedRef.current)
      const go = predrawGo({
        // 正在落笔/落擦：预绘制画完会 setLayerSlot ⇒ 触发批注层重绘 ⇒ 正画着的那一页闪一下
        // （落擦的 rect 等待期也算「手势已经开始」，见 beginErase）
        drawing: drawingRef.current || erasingRef.current || eraseSeedRef.current !== null,
        zoom: zoomRef.current,
        pinching: Boolean(pinchRef.current),
        animating: Boolean(turnRef.current?.frame()),
        queueBusy: busy,
        target,
        warm: target !== null && (prefetchPumpRef.current?.isWarm(target) ?? false),
        waitedMs: Date.now() - startedAt,
      })
      if (go === 'wait') {
        predrawTimerRef.current = setTimeout(tick, PREDRAW_WAIT_MS)
        return
      }
      if (go === 'skip') {
        // ⚠️ 从前这里是**终点**：队列一忙就再也不重排，于是整个滚动过程（每一页变化都占住
        // 队列）预绘制死透，手指停下也不会自己复活——真机「n 画好了、n+1 一直空白」的直接
        // 成因（2026-10-09）。队列忙只是**这一刻**的状态，过一拍再看；单槽队列永远只留最新
        // 一件，前台请求会把它顶掉，所以重排不会和前台抢。
        if (busy) predrawTimerRef.current = setTimeout(tick, PREDRAW_WAIT_MS)
        return
      }
      if (target === null) return
      runJobRef.current({ page: target, zoom: zoomRef.current, bg: true })
    }
    // UD 没有"滑出那块还要停稳"要等（PREDRAW_IDLE_MS 是为它留的）⇒ 立刻试；
    // LR 保留：换帧后 300ms 内那块画布可能还在滑，写它就是把动画打断
    predrawTimerRef.current = setTimeout(tick, modeRef.current === 'ud' ? 0 : PREDRAW_IDLE_MS)
  }, [pageCount])
  useEffect(() => {
    schedulePredrawRef.current = schedulePredraw
  }, [schedulePredraw])

  // 串行执行：一件渲完才起下一件。并发渲同一块画布会互相清屏（paintPageImage
  // 一上来就重设 canvas 尺寸），这是「快速翻页白页」的根源。
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
          // 队列**真的空了**：来一次心跳。「补渲染可见页」的 effect 依赖它——只靠滚动事件
          // 触发是不够的：手势停下后如果没有状态变化，最后一拍恰好遇到队列忙（早退）的那页
          // 就再没人管了（这正是 2026-10-09 真机「n 画好了、n+1 一直空白」的形态）。
          else setIdleTick((n) => n + 1)
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
  useDidShow(() => {
    invalidatePredraw('show')
    // 记账被清空 ⇒ UD 的画布全在屏外。回前台不补这一下，谱面会一直空着等用户操作
    if (docTick > 0) requestRef.current({ page: pageRef.current, zoom: zoomRef.current })
  })

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
    //
    // 泵**首帧落地之后**才启动（stage 到 ready）：它现在一上来就是整册下载、并发 4，
    // 与首帧那次取图抢带宽；首帧之后才启动，进册那一下不受影响。
    if (pageCount > 0 && stage === 'ready') {
      prefetchPumpRef.current?.setCurrent(clamp(page, 1, pageCount))
    }
    syncView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docTick, page, containerW, stage])

  // 缩放即时反馈：只换内容尺寸（旧帧被拉伸，清晰度靠随后的重渲补回来）
  useEffect(() => {
    if (docTick <= 0 || containerW <= 0) return
    const aspect = aspectRef.current
    if (aspect <= 0) return
    const w = Math.max(1, Math.round(containerW * zoom))
    const h = Math.max(1, Math.round(aspect * containerW * zoom))
    setViewSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
  }, [zoom, containerW, docTick])

  // 内容尺寸变了：位置重新钳制（缩放/翻页/转屏后不会拉出空白）。
  // 高度用 contentH：竖条模式下是整条的高度，不是一页高
  useEffect(() => {
    // 待落地的位移先补上再钳：钳制要按**最新**位置算，否则会「钳完旧值又被队列里的新值盖掉」
    flushPan()
    const [insetTop, insetBottom] = panInsets()
    commitPanIfMoved(
      clampPan(panRef.current, viewSize.w, contentH, containerW, containerH, insetTop, insetBottom)
    )
  }, [viewSize, contentH, containerW, containerH, commitPanIfMoved, flushPan, panInsets])

  // 上下模式：页码跟着**滚动位置**走（视口顶边落在哪一页）——徽标、批注、预热窗口都吃它。
  // 左右模式没有这条：那里的页码是用户翻出来的，不是滚出来的。
  useEffect(() => {
    if (!ud || !(pageH > 0) || pageCount <= 0) return
    // 基准线 = **菜单栏下沿**（不是屏幕顶）：工具条会盖住内容，按屏幕顶判就会把
    // 「页顶正好藏在菜单后面」的那一页当成当前页（用户 2026-10-09 报）。见 lib/strip.ts
    const { scroll, maxScroll } = stripViewport({
      panY: pan.y,
      pageH,
      pageCount,
      containerH,
      insetTop: barH.top,
      insetBottom: barH.bottom,
    })
    // 滚动方向：给「该先渲染视口哪一端」用（见下面的补渲染 effect）。内容上移 = 往下滚
    const prev = lastScrollRef.current
    if (scroll !== prev) udDirRef.current = scroll > prev ? 1 : -1
    lastScrollRef.current = scroll
    // ⚠️ 滚到条尾时由**末页**接管（2026-10-09，评审抓出）：pageH < 容器高时最大滚动量
    // `pageCount×页高 − 可用高` 小于 `(pageCount−1)×页高` ⇒ 末页的页首**永远够不到基准线**，
    // `pageFromScroll` 只能给到 N−1 ⇒ 徽标/书签/「清空本页」长期错一位，末页永远当不上
    // 「当前页」（2 页册滚到底显示「1 / 2」，跳页输入 2 会回弹成 1）。
    const p = scroll >= maxScroll - 1 ? pageCount : pageFromScroll(scroll, pageH, pageCount)
    if (p !== page) setPage(p)
  }, [ud, pan.y, pageH, pageCount, page, containerH, barH.top, barH.bottom])

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
  /**
   * 把某一块批注画布画成「它那一页现在该有的样子」。
   *
   * ⚠️ 只有尺寸真的不对时才重设画布（重设 = 清屏）。重绘本身是「查节点 → 清屏 → 画」
   * 一步到底（同一个 JS 时间片内完成），所以看不出中间态；但**落笔那一刻绝不能再清屏**
   * ——清了要等下一次异步补画才回来，真机上就是「一落笔整页笔迹闪一下」（见 beginStroke）。
   */
  const paintLane = useCallback(
    async (l: Layer, pageNo: number): Promise<void> => {
      const { w, h } = viewSizeRef.current
      if (!(w > 0) || !(h > 0)) return
      try {
        const { node } = await queryCanvasNode(CANVAS_OVERLAY_SEL[l])
        // ⚠️ 等待期间可能已经落笔了：**这时绝不能碰这块画布**——清屏会抹掉正画着的那一笔，
        // 而重设尺寸还会让画笔手里那个 ctx 失效（之后画什么都不出来，真机反馈
        // 「连续快速批注后完全不再显示，直到下一笔才恢复」）。落笔那一块由 drawLiveSegment
        // 增量维护，收笔后 annos 变化自然会重画一次。
        if (drawingRef.current && strokeLayerRef.current === l) return
        const overlay = node as CanvasNode
        const dpr = rasterDpr(w, h)
        const bw = Math.round(w * dpr)
        const bh = Math.round(h * dpr)
        if (overlay.width !== bw || overlay.height !== bh) {
          overlay.width = bw
          overlay.height = bh
        }
        const ctx = overlay.getContext('2d')
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, w, h)
        const strokes = annos[String(pageNo)] ?? []
        strokes.forEach((s) => drawStrokeOn(ctx, s, w, h))
      } catch {
        // 画布没挂载 / 未就绪：静默，下次状态变化会重试
      }
    },
    [annos, queryCanvasNode]
  )

  /**
   * 重画**每块**批注画布。
   *
   * ⚠️ **正在落笔的那一块一律跳过**：重画要清屏，会把用户画到一半的笔迹（与这一页已有的
   * 笔迹）抹掉再补上——真机上就是「批注时笔迹闪」。它的内容由 `drawLiveSegment` 增量维护，
   * 收笔后（annos 变化）自然会重画一次。落擦**不**跳过：擦除就是要把画面改掉。
   */
  const redrawOverlay = useCallback(async () => {
    if (viewSize.w <= 0 || viewSize.h <= 0 || pageCount <= 0) return
    // 手势中不重画：内容框被拉伸时位图跟着缩放即可，停手后由 gestureTick 补画
    if (pinchRef.current) return
    for (const l of ALL_LAYERS) {
      const p = layerSlot[l]
      if (p === null) continue
      if (drawingRef.current && strokeLayerRef.current === l) continue
      await paintLane(l, p)
    }
  }, [layerSlot, paintLane, pageCount, viewSize])

  useEffect(() => {
    // ⚠️ 依赖里必须有 layerSlot：批注层是跟着「这块画布显示着哪一页」走的，
    // 换页 / 切模式 / 换册都会改它，少一个就会出现「切换模式后批注层还留在旧位置」
    if (docTick > 0) void redrawOverlay()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docTick, page, viewSize, annos, gestureTick, layerSlot, tool, penOn])

  const persist = useCallback(
    (next: AnnoDoc) => {
      annosRef.current = next
      setAnnos(next)
      // 本地一改就两件事：记「可能有欠账」（离线改了 3 册然后被强杀，别的册只有靠它才会被扫到），
      // 以及起一次停笔防抖（连续画十几笔只在停下时推一次，见 annotation-sync-runner）
      if (fileId) {
        markAnnoPending()
        scheduleAnnotationSync(fileId)
      }
      // 写不进去（存储满 / 单键超限）以前是**完全静默**的：画面照旧、退出重进才发现丢了，
      // 线上一条线索都没有（评审抓出）。每册每次会话只报一次——存储满会一直失败。
      if (fileId && !saveAnnoDoc(fileId, next) && !annoSaveFailRef.current) {
        annoSaveFailRef.current = true
        reportClientError({
          event: 'score_reader_annotation_save_failed',
          message: 'setStorageSync 失败（存储满/超限？）',
          detail: { fileId, pages: Object.keys(next).length },
        })
      }
    },
    [fileId]
  )

  const load = useCallback(async () => {
    let finalUrl = ''
    let imagePageTotal = 0
    // 上一册的本地记账先落盘（换册 = 这一册的账到此为止；不落就整册白下）
    flushAlbumFiles.current()
    flushAlbumFiles.current = () => {}
    prefetchPumpRef.current?.stop()
    prefetchPumpRef.current = null
    // 取图策略（图片层 / downloadFile 兜底）的判定也跟着复位：换册=换了网络场景，
    // 用户点「重试」=明确要求重来一次，两处都值得重新判一遍（见 page-image 的注释）
    resetPageImageStrategy()
    setBandColor(null) // 纸色也作废：新册第一帧采到之前，先退回默认灰带
    historyRef.current = [] // 撤销栈不跨册
    setUndoDepth(0)
    invalidatePredraw('load') // 换册：备用块上那一帧属于上一册，作废
    setNoImages(false)
    // 「显示中的页」作废：换册后的首帧不滑（换册前后页码可能撞上，靠它区分）。
    // 上一册那一段滑出不用管——它自己 200ms 内会停靠
    displayedPageRef.current = 0
    const tStart = Date.now()
    timingRef.current = { startedAt: tStart }
    setStage('fetching')
    setMessage('')
    try {
      if (!fileId) throw new Error(t('scoreReader.notFound'))
      if (presetStoragePath && presetPageCount > 0) {
        // 快速路径：列表页已把元数据带来 —— 省掉整次查询（那是首帧最大的一项）
        finalUrl = supabase.storage.from('sheet-music').getPublicUrl(presetStoragePath)
          .data.publicUrl
        imagePageTotal = presetPageCount
        if (presetFileName) void Taro.setNavigationBarTitle({ title: presetFileName })
      } else {
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
        imagePageTotal = fileMeta.page_count ?? 0
        void Taro.setNavigationBarTitle({ title: fileMeta.file_name })
      }
      timingRef.current.metaMs = Date.now() - tStart
      if (!finalUrl) throw new Error(t('scoreReader.loadFailed', { error: 'no url' }))
      fileUrlRef.current = finalUrl

      // ⚠️ `page_count` 是「**页图就绪**」的开关（pkuso-web #378），不是「总页数」那么简单：
      // 这里**绝不能回填**它（曾经 admin/score_manager 打开时写总页数 ⇒ 没有页图的老文件
      // 被标成「有页图」，阅读器进来却找不到页图）。由 web 端在上传（预渲染页图那一次）写入。
      //
      // 没有页图的（预渲染失败、或还没跑迁移）⇒ 不在 App 里渲染，直接引导「保存到…」。
      // 这是拿掉 pdf.js 运行时（分包里 1.6MB）之后唯一的代价：这类文件交给系统阅读器。
      if (!(imagePageTotal > 0)) {
        setNoImages(true)
        setStage('error')
        return
      }

      setPageCount(imagePageTotal)
      // 书签：上次读到哪页就回到哪页
      const savedImg = fileId ? Number(Taro.getStorageSync(lastPageKey(fileId))) : NaN
      setPage(
        Number.isFinite(savedImg) && savedImg >= 1
          ? clamp(Math.round(savedImg), 1, imagePageTotal)
          : 1
      )
      applyZoom(1)
      // 换册以复位为准：队列里可能还压着上一册的位移，先丢掉（否则它会在之后把画面挪走）
      panQueueRef.current?.cancel()
      commitPan({ x: 0, y: 0 })
      renderedZoomRef.current = 1
      aspectRef.current = 0
      // 页图预热泵：首帧仍走前台路径；泵由 doRender 的首个 setCurrent 启动——不与首帧
      // 抢带宽。**整册**（窗口概念退役，2026-10-09：见 lib/page-image.ts 的
      // prefetchPageImage 与 lib/prefetch-pump.ts 的 PREFETCH_PARALLEL——泵现在走
      // downloadFile 落本地文件，不再经过图片层，因此不怕并发）。优先级仍是「当前页
      // 前后 3 页 → 向后铺到底 → 向前补」，用户翻页时 setCurrent 把优先带挪过去（插队）。
      totalPagesRef.current = imagePageTotal
      viaTallyRef.current = { file: 0, image: 0, download: 0 }
      prefetchFailRef.current = 0
      pageSourceSentRef.current = false
      // **跨会话复用**（见 lib/page-file-store.ts）：把上次留下的本地文件逐条探活后登记回
      // 记账——文件还在的页，泵与前台都会直接命中，一次网络都不用（`via: file`）。
      // 刻意**不 await 在首帧之前**：它只决定「要不要重下」，而首帧等不起这一轮探活；
      // 泵那边靠 `adopt` 排队（见 prefetchOne），所以不会出现「探活还没完就重下」。
      const adopt = loadAliveAlbum(fileId, imagePageTotal, pageFileStore(), Date.now())
        .then((paths) => {
          paths.forEach((path, i) => {
            if (path) registerLocalFile(pageFileKey(i + 1), path)
          })
        })
        // 探活本身不该抛（Storage/FS 的每个调用点都各自 try 过）——真抛了也必须兜住：
        // `prefetchOne` 在它上面 await，一拒就是**整册**每页都按「失败即跳过」处理，
        // 结果是一个静默的「预下载全废」。宁可按「什么都没探到」继续。
        .catch(() => {})
      // 记账落盘：换册 / 泵排空 / 离开页面 / 翻页防抖四处调它（见 flushAlbumFiles）
      flushAlbumFiles.current = () => {
        const snapshot = Array.from(
          { length: imagePageTotal },
          (_, i) => localFileFor(pageFileKey(i + 1)) ?? ''
        )
        saveAlbum(fileId, snapshot, pageFileStore(), Date.now())
      }
      prefetchPumpRef.current = createPrefetchPump({
        total: imagePageTotal,
        urlsFor: (n) => pageImageUrls(fileUrlRef.current, n),
        prefetchOne: async (url, pageNo) => {
          // 探活没完之前不下手：否则会把「本地其实已经有」的页又下一遍
          await adopt
          return prefetchPageImage(url, { key: pageFileKey(pageNo) })
        },
        // 离线不派请求（见 lib/net-status.ts）：一进册就没网时不该刷一屏失败
        isOnline,
        windowAhead: imagePageTotal,
        windowBehind: imagePageTotal,
        // 预下载是后台行为，失败不给用户弹东西——那它失败了就没人知道，所以这里上报。
        // 只实时报前 3 条：整册都失败时不该把错误表刷成 34 行（总数在 page_source 那条里）
        onFail: (failedPage, err) => {
          prefetchFailRef.current += 1
          if (prefetchFailRef.current <= 3) {
            reportClientError({
              event: 'score_reader_prefetch_failed',
              message: describeError(err),
              detail: { fileId, page: failedPage, total: imagePageTotal },
            })
          }
        },
        onIdle: () => {
          // 泵排空 = 这一册的本地文件齐了：立刻落盘（此刻落，下次进册就是整册命中）
          flushAlbumFiles.current()
          reportPageSource()
        },
      })
      setDocTick((tick) => tick + 1)
    } catch (err) {
      setStage('error')
      setMessage(describeError(err))
      reportClientError({
        event: 'score_reader_load_failed',
        message: describeError(err),
        detail: { fileId },
      })
    }
  }, [
    applyZoom,
    commitPan,
    fileId,
    invalidatePredraw,
    pageFileKey,
    presetFileName,
    presetPageCount,
    presetStoragePath,
    reportPageSource,
    t,
  ])

  // 自动加载：带 file_id 进入时
  useEffect(() => {
    if (fileId) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clampPage = (n: number) => clamp(Math.round(n), 1, Math.max(pageCount, 1))

  /**
   * 上下模式：把视图**滚动**到第 n 页（连续滚动，不吸附到别的对齐方式）。
   * 落点是「这一页的页顶对齐**菜单栏下沿**」，不是对齐屏幕顶——工具条会盖住内容。
   * 非竖条模式（内容比视口矮）时 clampPan 会把它居中，也就无从滚动——没关系。
   */
  const scrollToPage = (n: number) => {
    const h = viewSizeRef.current.h
    if (!(h > 0)) return
    // 离散动作以自己为准：队列里压着的位移先丢掉，否则它会在之后盖掉这次滚动
    panQueueRef.current?.cancel()
    const [insetTop, insetBottom] = panInsets()
    commitPanIfMoved(
      clampPan(
        // 落点 = 「这一页的页顶对齐**菜单栏下沿**」。对齐屏幕顶的话页顶就藏在菜单后面
        // ——用户 2026-10-09 报的「切换到第 n 页，n 的顶部被菜单栏挡住」就是它
        { x: panRef.current.x, y: insetTop - pageTop(clampPage(n), h) },
        viewSizeRef.current.w,
        stripHeight(h, pageCount),
        containerW,
        containerH,
        insetTop,
        insetBottom
      )
    )
  }

  /** 上下模式：往上/下移动**一页的高**（点分区用；不吸附，见 lib/strip.ts） */
  const scrollByPage = (dir: 1 | -1) => {
    const h = viewSizeRef.current.h
    if (!(h > 0)) return
    panQueueRef.current?.cancel()
    const [insetTop, insetBottom] = panInsets()
    commitPanIfMoved(
      clampPan(
        { x: panRef.current.x, y: panRef.current.y - dir * h },
        viewSizeRef.current.w,
        stripHeight(h, pageCount),
        containerW,
        containerH,
        insetTop,
        insetBottom
      )
    )
  }

  const gotoPage = (n: number) => {
    if (pageCount <= 0) return
    cancelStroke()
    const target = clampPage(n)
    // turnMs（页码变化 → 换帧）的诊断基准，也是「翻页 <150ms」那个指标
    if (target !== pageRef.current) pageChangeAtRef.current = Date.now()
    // 上下模式：翻页就是**滚过去**——页码变了但视图不动的话，用户看到的是另一页
    if (modeRef.current === 'ud') scrollToPage(target)
    setPage(target)
  }

  // 书签：翻到哪页就记哪页，下次进来接着读
  useEffect(() => {
    if (fileId && pageCount > 0) Taro.setStorageSync(lastPageKey(fileId), String(page))
  }, [fileId, page, pageCount])

  /**
   * 本地记账的防抖落盘：翻页后静置 2 秒写一次。
   *
   * 为什么还要这一处（`onIdle`/`useUnload` 已经覆盖了大多数情形）：用户翻着翻着被系统杀掉
   * 进程时，`useUnload` **不会触发**，那一册的记账就整册丢了（白下一次）。2 秒静置既避开
   * 连续翻页时的反复序列化，又让「读到哪、下到哪」基本追上。
   */
  useEffect(() => {
    if (docTick <= 0 || !fileId) return
    const timer = setTimeout(() => flushAlbumFiles.current(), 2000)
    return () => clearTimeout(timer)
  }, [page, docTick, fileId])

  /**
   * 网络恢复：把泵叫醒。离线时进册泵一页都没派（见 lib/prefetch-pump.ts 的 isOnline），
   * 而 `setCurrent` 正是「重新起泵」的信号（它内部会 `void run()`）。
   */
  useEffect(() => onReconnect(() => prefetchPumpRef.current?.setCurrent(pageRef.current)), [])

  /**
   * 触点 → **页内归一化坐标**（0~1，相对这一页的内框）。
   *
   * 落笔那一刻已经定死了「画在哪一页、哪一块批注画布」（见 strokePageRef / strokeLayerRef），
   * 所以这里**不再需要任何零点/窗口换算**——画布就是那一页，画出来哪儿就是哪儿。
   * （早先按「页坐标 + 窗口零点」换算，连出两个真机 bug：忘减零点 ⇒ 落笔看不见；
   * 减两次 ⇒ 越修越偏。现在坐标系只剩一种，这类错没有生存空间。）
   */
  const pointOf = (clientX: number, clientY: number): [number, number] => {
    const rect = overlayRectRef.current
    const { w, h } = viewSizeRef.current
    if (!rect || w <= 0 || h <= 0) return [0, 0]
    return [clamp((clientX - rect.left) / w, 0, 1), clamp((clientY - rect.top) / h, 0, 1)]
  }

  const cancelStroke = () => {
    // 画了一半就被打断（转双指 / 系统打断 / 收起批注）：把那条线从画面上抹掉。
    // 必须在清 ref 之前调——重画要用到「画在哪一页、哪一块」
    if (drawingRef.current) repaintLiveStroke(null)
    drawingRef.current = false
    erasingRef.current = false
    strokePtsRef.current = []
    strokeSeedRef.current = null
    strokeLayerRef.current = null
    erasedRef.current = null
    eraseSeedRef.current = null
    erasePendingRef.current = []
  }

  /**
   * 手指落在**哪一页**上、那一页在哪一块画布上（落笔/落擦都要先定这个）。
   * 找不到（那一页还没渲染进任何一块）就返回 null —— 不落笔，免得记到别的页上。
   */
  const laneUnderPoint = (clientY: number): { page: number; layer: Layer } | null => {
    const h = viewSizeRef.current.h
    if (!(h > 0) || pageCount <= 0) return null
    // 读同步镜像而不是渲染闭包：刚落完笔就滚一下再落笔时，闭包里的 pan 可能差一帧
    const p = ud
      ? pageFromScroll(clientY - stageRectRef.current.top - panRef.current.y, h, pageCount)
      : pageRef.current
    const layer = ALL_LAYERS.find((l) => layerSlot[l] === p)
    return layer ? { page: p, layer } : null
  }

  // 起笔：rect 必须当次现取（工具条显隐会挪动画布），取到之前不落笔——
  // 拿旧 rect 算出的首点会连出一条「从按钮到落笔处」的飞线
  const beginStroke = (touch: { clientX: number; clientY: number }) => {
    cancelStroke()
    const lane = laneUnderPoint(touch.clientY)
    if (!lane) return
    // 种子对象**同时是这段手势的身份**：下面按引用比对，判断 rect 回来时这段手势还在不在
    // （抬起 / 转双指 / 换册 / 又落了一笔都会把它换掉或清掉）
    const seed = { x: touch.clientX, y: touch.clientY }
    strokeSeedRef.current = seed
    strokeLayerRef.current = lane.layer
    strokePageRef.current = lane.page
    void (async () => {
      try {
        const { node, left, top } = await queryCanvasNode(CANVAS_OVERLAY_SEL[lane.layer])
        // ⚠️ 先确认这段手势没被取代再写 rect：两次节点查询的返回顺序没有保证，晚到的那次
        // 会把**后一段手势**的 rect 覆盖成自己的（那块画布可能在别的位置）⇒ 坐标全错位
        if (strokeSeedRef.current !== seed) return
        overlayRectRef.current = { left, top }
        // ⚠️ 这里**只取 ctx，绝不重设画布尺寸**：重设 = 清屏，而补画是异步的（要等节点查询）
        // ⇒ 一落笔整页笔迹先消失、几十~几百毫秒后才回来，反复落笔就是「批注时笔迹闪」。
        // 画布尺寸/已有笔迹由 paintLane 负责（它只在尺寸真的不对时才重设，且清屏与重画
        // 在同一个 JS 时间片里完成，看不出中间态）。
        const ctx = (node as CanvasNode).getContext('2d')
        const { w, h } = viewSizeRef.current
        ctx.setTransform(rasterDpr(w, h), 0, 0, rasterDpr(w, h), 0, 0)
        overlayCtxRef.current = ctx
      } catch {
        cancelStroke()
        return
      }
      if (strokeSeedRef.current !== seed) return // 手指已抬起 / 已转双指 / 已换册
      strokeSeedRef.current = null
      drawingRef.current = true
      strokePtsRef.current = [pointOf(seed.x, seed.y)]
    })()
  }

  /**
   * 把**正在画的这一笔**按落定后的样子画出来：清屏 → 重画这一页已落定的笔迹 → 画整条在画的线。
   *
   * ⚠️ 为什么整条重画，而不是「每来一个触点就 stroke 一小段」（从前的做法）：分段描边会
   * **自己叠自己**——相邻两段在共享端点处重叠，圆头笔帽又加重它，而半透明的荧光笔叠一次
   * 就深一层 ⇒ 一条线越画越深，松手后整条重画一次又突然变浅（真机反馈：一个笔迹在画的
   * 过程中不该有两个样子）。整条一笔画出来的路径与**落定后**的绘制路径完全同形，中途就与
   * 松手之后一致。
   *
   * `live` 传 null = 只画已落定的（撤掉一条画了一半就被打断的线时用）。
   *
   * 代价是每个触点重画一遍这一页的笔迹。可接受：**擦除那条路早就是这个量级**——
   * `eraseAtPoints` 每个触点都 `persist` 一次，而它会把三块批注层整页重画；这里只重画一块。
   * 另外 `paintLane` 在落笔期间**故意不碰**这块画布（见那里的注释），所以这段期间的画面
   * 本来就只由这里维护。
   */
  const repaintLiveStroke = (live: [number, number][] | null) => {
    const ctx = overlayCtxRef.current
    if (!ctx || !strokeLayerRef.current) return
    const { w, h } = viewSizeRef.current
    if (!(w > 0) || !(h > 0)) return
    ctx.clearRect(0, 0, w, h)
    for (const s of annosRef.current[String(strokePageRef.current)] ?? []) {
      drawStrokeOn(ctx, s, w, h)
    }
    if (live && live.length > 0) {
      drawPolylineOn(
        ctx,
        live,
        penColor,
        brushWidth,
        w,
        h,
        tool === 'highlighter' ? HIGHLIGHTER_ALPHA : 1
      )
    }
  }

  const drawLiveSegment = (touch: { clientX: number; clientY: number }) => {
    if (!overlayCtxRef.current) return
    strokePtsRef.current.push(pointOf(touch.clientX, touch.clientY))
    repaintLiveStroke(strokePtsRef.current)
  }

  /**
   * 落擦：和落笔一样先定死「擦哪一页、哪一块画布」（坐标要按那块画布的 rect 算）。
   *
   * ⚠️ 与落笔**同形**：rect 取到之前不置 `erasingRef`。rect 是异步取回的，而它在两段手势
   * 之间会变（工具条显隐、UD 里滚动都挪动画布）——从前这里同步置位，于是 rect 回来之前的
   * 那几个 move 拿着**上一段手势的 rect** 算坐标，擦掉的是别处的笔迹（还照样进撤销栈）。
   * 等待期间到达的触点攒进 erasePendingRef，rect 到手后连同起点一并补擦。
   */
  const beginErase = (touch: { clientX: number; clientY: number }) => {
    cancelStroke()
    const lane = laneUnderPoint(touch.clientY)
    if (!lane) return
    strokeLayerRef.current = lane.layer
    strokePageRef.current = lane.page
    const seed = { clientX: touch.clientX, clientY: touch.clientY }
    eraseSeedRef.current = seed
    void (async () => {
      try {
        const { left, top } = await queryCanvasNode(CANVAS_OVERLAY_SEL[lane.layer])
        // 同 beginStroke：先确认这段手势还在，别把**后一段**手势的 rect 覆盖成自己的
        if (eraseSeedRef.current !== seed) return
        overlayRectRef.current = { left, top }
      } catch {
        cancelStroke()
        return
      }
      if (eraseSeedRef.current !== seed) return // 手指已抬起 / 已转双指 / 已换册：整段作废
      eraseSeedRef.current = null
      erasingRef.current = true
      const pending = erasePendingRef.current
      erasePendingRef.current = []
      eraseAtPoints([seed, ...pending])
    })()
  }

  /**
   * 橡皮擦：手指划过的笔迹**整条删掉**（不做逐点擦除——那会把笔迹切碎、也没法撤销）。
   * 命中判据见 lib/anno-draw.ts 的 eraseStrokesAt / strokeHitByPoint。
   *
   * 收**一组**触点而不是一个：rect 等待期攒下的触点要一次补擦，且必须成组过滤——逐点各
   * 改一次数据的话，后一次会把前一次的结果盖掉（见 eraseStrokesAt 的注释）。
   */
  const eraseAtPoints = (touches: Array<{ clientX: number; clientY: number }>) => {
    const rect = overlayRectRef.current
    const { w, h } = viewSizeRef.current
    if (!rect || !(w > 0) || !(h > 0)) return
    const key = String(strokePageRef.current)
    const cur = annosRef.current[key] ?? []
    if (cur.length === 0) return
    const kept = eraseStrokesAt(
      cur,
      touches.map((touch) => ({ x: touch.clientX - rect.left, y: touch.clientY - rect.top })),
      ERASER_RADIUS_PX,
      w,
      h
    )
    if (kept.length === cur.length) return
    if (!erasedRef.current) erasedRef.current = cur // 本段手势擦掉之前的原样（抬手时记进撤销栈）
    persist({ ...annosRef.current, [key]: kept })
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
    // 锚点按**最新**位置算（同步镜像）；这是离散动作，队列里压着的位移先丢掉
    const cx = containerW / 2 - panRef.current.x
    const cy = containerH / 2 - panRef.current.y
    const w = Math.max(1, Math.round(containerW * s1))
    const h = Math.max(1, Math.round(aspect * containerW * s1))
    applyZoom(s1)
    panQueueRef.current?.cancel()
    const [insetTop, insetBottom] = panInsets()
    commitPanIfMoved(
      clampPan(
        { x: containerW / 2 - cx * k, y: containerH / 2 - cy * k },
        w,
        ud ? stripHeight(h, pageCount) : h,
        containerW,
        containerH,
        insetTop,
        insetBottom
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
      // 灰带优先：菜单关着时上下两条灰带**任意位置**的**点击**都只开关菜单，不翻页/不滚动。
      // ⚠️ 只管点击——**滑动照常翻页**（见下面 swipeDir 那一段）：拇指在屏幕下沿横滑是最省力
      // 的翻页姿势，灰带又是不可见的，在那里让手势静默失效会被读成「翻页失灵」（2026-10-09 定）。
      if (g.band) {
        setMenuOn((on) => !on)
        return
      }
      // 分区：左右模式看横轴（25/50/25，点两侧翻页），上下模式看纵轴
      // （20/60/20，点上下方滚动一页的距离）——分区判据见 lib/layout.ts
      const zone = ud ? zoneOnAxis(g.relY, containerH, ZONE_SPLITS_UD) : zoneFor(g.relX, containerW)
      if (zone === 'menu') {
        setMenuOn((on) => !on)
        return
      }
      if (ud) {
        if (g.canScroll) scrollByPage(zone === 'next' ? 1 : -1)
        return
      }
      if (!g.canTurn) return
      gotoPage(pageRef.current + (zone === 'next' ? 1 : -1))
      return
    }
    if (ud) return // 上下模式的滑动就是滚动本身（移动阶段已经滚过了），抬手不再做别的
    // 这里**刻意不查 g.band**：灰带只截点击，滑动照样翻页（理由见上面 isTap 分支的注释）
    if (!g.canTurn || !end) return
    const dir = swipeDir(g, end.clientX, end.clientY, swipeMinPx(containerW))
    if (dir === 0) return
    if (blockedByEdgeGuard(g.relX, dir)) return
    // 回滚这次手势造成的平移：用户意图是翻页，不是把谱面挪走
    // （抬手已经 flush 过；这里再 cancel 一次是防御——队列里若还压着值，它会盖掉回滚）
    panQueueRef.current?.cancel()
    commitPanIfMoved(
      clampPan(
        { x: g.x, y: g.y },
        viewSizeRef.current.w,
        contentHRef.current,
        containerW,
        containerH
      )
    )
    gotoPage(pageRef.current + dir)
  }

  const onTouchStart = (e: ITouchEvent) => {
    // 起手先补上一段手势的最后一拍：合帧队列里可能还压着 ≤1 帧的位移，
    // 下面两处的基准位置（drag / pinch 的 pan）读的是同步镜像，差一帧就是「接着滑时先往回跳一下」
    flushPan()
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
        pan: panRef.current,
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
      if (tool === 'eraser') beginErase(touch)
      else beginStroke(touch)
      return
    }
    // ⚠️ 这里**不再**按 docTick <= 0 早退：菜单默认隐藏，文档还没加载出来时也得能
    // 点中间把菜单叫出来（否则无 file_id 的调试入口连菜单都打不开）
    const relX = touch.clientX - stageRectRef.current.left
    const relY = touch.clientY - stageRectRef.current.top
    dragRef.current = {
      tx: touch.clientX,
      ty: touch.clientY,
      // 基准读同步镜像（起手那一刻已经 flush 过，见 onTouchStart 开头）
      x: panRef.current.x,
      y: panRef.current.y,
      relX,
      relY,
      startAt: Date.now(),
      maxMove: 0,
      // 灰带的点击规则跟着灰带的**可见性**走：放大后不画灰带，那里也就按普通分区处理
      // 上下边缘＝隐藏菜单命中区：只有左右模式保留（见 JSX 里那段注释）
      band:
        modeRef.current === 'lr' && zoomRef.current <= 1
          ? bandAt(relY, containerH, barH.top, barH.bottom)
          : null,
      // 翻页手势只有左右模式有；上下模式里「点分区」是滚动（放大后也照样能滚）
      canTurn: modeRef.current === 'lr' && docTick > 0 && pageCount > 0 && zoomRef.current <= 1,
      canScroll: modeRef.current === 'ud' && docTick > 0 && pageCount > 0,
    }
  }

  const onTouchMove = (e: ITouchEvent) => {
    if (drawingRef.current && e.touches.length === 1) {
      const touch = e.touches[0]
      if (touch) drawLiveSegment(touch)
      return
    }
    if (eraseSeedRef.current && e.touches.length === 1) {
      // 落擦的 rect 还没回来：先攒着，别拿上一段手势的 rect 擦（见 beginErase）
      const touch = e.touches[0]
      if (touch) erasePendingRef.current.push({ clientX: touch.clientX, clientY: touch.clientY })
      return
    }
    if (erasingRef.current && e.touches.length === 1) {
      const touch = e.touches[0]
      if (touch) eraseAtPoints([touch])
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
      // ⚠️ 这里**不走合帧队列**：缩放本身每 move 就改一次状态、必然渲染一次，
      // 合帧省不下任何东西，却会让平移比缩放晚一拍落地（这一帧里内容按旧位移显示新尺寸）。
      // 与 applyZoom 同一次事件里落地 ⇒ 同一次渲染带上两者（与从前完全一致）。
      const [insetTop, insetBottom] = panInsets()
      commitPanIfMoved(
        clampPan(
          {
            x: mx - stageRectRef.current.left - (g.midX - g.pan.x) * k,
            y: my - stageRectRef.current.top - (g.midY - g.pan.y) * k,
          },
          w,
          modeRef.current === 'ud' ? stripHeight(h, pageCount) : h,
          containerW,
          containerH,
          insetTop,
          insetBottom
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
      // 上下模式：拖动**永远**是在滚动（竖条比视口高，纵向一定有可滚的余地）；
      // 左右模式下未放大时内容不宽于视口，横向那一项本来就是空操作。
      // 走合帧队列：touchmove 的密度按屏幕刷新率来，逐条 setData 会把链路压满（见 pan-queue）
      const [insetTop, insetBottom] = panInsets()
      panTo(
        clampPan(
          { x: d.x + dx, y: d.y + dy },
          viewSize.w,
          contentHRef.current,
          containerW,
          containerH,
          insetTop,
          insetBottom
        )
      )
    }
  }

  const onTouchEnd = (e: ITouchEvent) => {
    // 抬手先把合帧队列里最后一段位移补上：不补就是「手指停了，画面还差一截」
    flushPan()
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
          // 落在**落笔时定死的那一页**上（见 strokePageRef）：画布就是那一页，坐标就是页内的，
          // 不需要任何跨页切分
          const key = String(strokePageRef.current)
          const before = annosRef.current[key] ?? []
          // 荧光笔固定半透明；画笔不写这个字段（旧数据也没有，两边都按 1 读）
          const stroke: AnnoStroke = {
            color: penColor,
            width: brushWidth,
            points: pts,
            alpha: tool === 'highlighter' ? HIGHLIGHTER_ALPHA : undefined,
          }
          pushHistory(strokePageRef.current, before)
          persist({ ...annosRef.current, [key]: [...before, stroke] })
        }
        strokeLayerRef.current = null
      }
      if (erasingRef.current) {
        // 擦完一段：把「擦之前那页的原样」记成**一步**（撤销要能整段退回来）
        erasingRef.current = false
        const before = erasedRef.current
        erasedRef.current = null
        if (before) pushHistory(strokePageRef.current, before)
        strokeLayerRef.current = null
      }
      strokeSeedRef.current = null
      // 落擦还没等到 rect 就抬手了：整段作废（与从前「点一下什么都没发生」一致）。
      // 必须清掉——否则那个异步块回来时手指早已不在屏上，却照样开擦
      eraseSeedRef.current = null
      erasePendingRef.current = []
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
    // 平移照常补上最后一拍：被系统打断时画面停在手指最后的位置，比往回跳一帧好
    flushPan()
    cancelStroke()
    dragRef.current = null
    multiTouchRef.current = false
    if (pinchRef.current) {
      pinchRef.current = null
      setGestureTick((n) => n + 1)
    }
  }

  /** 记一步撤销（见 historyRef）：操作前的状态 + 页码 */
  const pushHistory = (pageNo: number, before: AnnoStroke[]) => {
    historyRef.current.push({ page: pageNo, before })
    if (historyRef.current.length > 50) historyRef.current.shift() // 只留最近 50 步
    setUndoDepth(historyRef.current.length)
  }

  /** 撤销**一步操作**（画一笔 / 擦掉若干笔都算一步）——不是「删掉最后一笔」 */
  const handleUndo = () => {
    const op = historyRef.current.pop()
    setUndoDepth(historyRef.current.length)
    if (!op) return
    persist({ ...annosRef.current, [String(op.page)]: op.before })
  }

  /**
   * 清空当前页。⚠️ 两件事都不能省（评审 2026-10-09 抓出）：
   * 1. **先记一步撤销**——从前它不进栈，于是「清空」不可撤销，而栈顶还留着清空前的快照，
   *    用户点撤销会**删掉最后一笔**而不是恢复清空（数据丢失、无 redo）；
   * 2. 清的是 `page`（UD 下 = 视口顶边那页）——所以按钮文案必须带上页码（见 AnnotationBar
   *    的 clearPage），否则「本页」在 UD 里是歧义的：写/擦按**手指位置**定页，清空按顶边页。
   */
  const handleClear = () => {
    const key = String(page)
    const before = annosRef.current[key] ?? []
    if (before.length === 0) return // 没笔迹就没有可撤销的一步
    pushHistory(page, before)
    persist({ ...annosRef.current, [key]: [] })
  }

  const togglePen = () => {
    cancelStroke()
    dragRef.current = null
    multiTouchRef.current = false
    const next = !penOn
    setPenOn(next)
    // 进批注必须把菜单打开：底栏那个铅笔按钮是它唯一的出口，菜单关着就出不来了
    if (next) setMenuOn(true)
  }

  /**
   * 「保存到…」（共用逻辑见 hooks/usePdfHandoff）：把这份谱的 **PDF** 交给用户能看见的
   * 地方（收藏 / 聊天 / 系统 / 电脑磁盘）。小程序自己写不了用户可见的目录，所以
   * 「用户知道文件在哪」的唯一解是**把文件送出去**（见 lib/pdf-handoff.ts）。
   *
   * `url` 传**取值函数**而不是值：`fileUrlRef` 是 ref，渲染期读会拿到空串。
   */
  const handoff = usePdfHandoff()
  /** 顶栏那个按钮要开的是**这一册**（元数据在 open 时给，见 usePdfHandoff 的注释） */
  const openHandoff = () => {
    // 「保存到…」也是底栏五个之一 ⇒ 开它就收掉另外两个（同 openPanel 的互斥理由）
    setBottomPanel('none')
    setPenOn(false)
    handoff.open({
      fileId,
      url: () => fileUrlRef.current,
      title: presetTitle,
      section: presetSection,
      fileName: presetFileName,
      expectedBytes: presetBytes,
    })
  }

  /** 底栏上方此刻开着哪个气泡（同时只能开一个） */
  const [bottomPanel, setBottomPanel] = useState<ReaderPanel>('none')
  /**
   * 底栏五个功能是**单选组**：开一个就收掉另一个。
   *
   * 为什么必须互斥（真机反馈「一个启用时点另一个没反应」）：**批注栏与气泡贴在同一个位置**
   * （都在底栏正上方，`bottom: 100%` 与 `penBarBottom` 相等），而且同为 `Z_TOOLBAR` ——
   * 批注栏在 DOM 里排在底栏**之后**，于是气泡开在它后面，看起来就是「点了没反应」。
   * ⚠️ 靠调 z 序解决不了：气泡是底栏的子节点，底栏自己有 z-index ⇒ 已成层叠上下文，
   * 子节点的 z 再大也顶不出底栏那一层。**只能靠互斥**。
   */
  const openPanel = (p: ReaderPanel) => {
    if (p !== 'none') setPenOn(false)
    setBottomPanel(p)
  }
  /**
   * 进度条轨道宽度：屏幕宽的 2/5（用户 2026-10-10 定，**不随页数增长**）。
   *
   * ⚠️ 用**同步**的 `getWindowInfo().windowWidth`，**不用** `containerW` —— 后者是
   * `createSelectorQuery` 量出来的；真机上两个气泡（页码条与缩放那排）被一起压窄，
   * 就是那个测量值不可靠造成的。`getSystemInfoSync` 已被微信废弃（每次调用刷一条
   * deprecation 告警），别换回去。
   */
  const trackW = Math.round((readScreenWidth() || 375) * 0.4)
  /** 批注：从底栏点进来时先把气泡收掉（两者贴在同一个位置，见 openPanel 的注释） */
  const penFromToolbar = () => {
    setBottomPanel('none')
    togglePen()
  }
  /** 缩放气泡的三个动作（按钮只报「哪一种」，具体换算留在页面里） */
  const handleZoom = (kind: 'in' | 'out' | 'fit') => {
    if (kind === 'in') zoomAtCenter(zoom + 0.25)
    else if (kind === 'out') zoomAtCenter(zoom - 0.25)
    else zoomAtCenter(1)
  }

  // 「还没画出一帧」就一直显示 —— 判据是**首帧真的换帧**（stage 到 ready），而不是
  // 「画布尺寸有没有值」：图片模式下 `setViewSize` 发生在绘制**之前**，按尺寸判会让
  // 提示在画面出来之前就消失（真机反馈：第一次「进度走完但没渲染出来」、第二次
  // 干脆不显示 —— 同一个成因）
  const showStatusRow = stage !== 'ready' && stage !== 'error'
  const boxW = viewSize.w || containerW || 0
  const boxH = viewSize.h || 0
  /** 某块画布此刻**显示着**哪一页——竖条模式靠它摆位（见 layerSlot 的注释） */
  const layerPageOf = (l: Layer): number | null => layerSlot[l]
  /**
   * 视口里**还没渲染出来**的页：在它们各自的中心显示一个加载圆圈（用户 2026-10-09 定）。
   * 用途是「看得见但还没有内容」的那些页——空白与「这页本来就白」在屏幕上分不开，
   * 给个明确在加载的信号，别让人以为卡住了。
   */
  const renderedPages = new Set(Object.values(layerSlot).filter((p): p is number => p !== null))
  /** 竖条模式的视口状态（基准线 = 菜单栏下沿 + 可用高内缩，见 lib/strip.ts 的 stripViewport） */
  const udView = stripViewport({
    panY: pan.y,
    pageH: boxH,
    pageCount,
    containerH,
    insetTop: barH.top,
    insetBottom: barH.bottom,
  })
  /** 判据的基准：竖条 = 基准线在条内的位置；左右 = 当前页页首（退化成只看这一页） */
  const viewScroll = ud ? udView.scroll : (clamp(page, 1, Math.max(pageCount, 1)) - 1) * boxH
  /** 可用视口高：竖条按工具条内缩；左右 = 一页高 */
  const viewH = ud ? udView.usableH : boxH
  const pending = pendingPages(viewScroll, boxH, viewH, pageCount, renderedPages)
  // 给后台写帧用的两份镜像：**渲染期同步写**（晚一拍就可能在「已经可见」的块上写内容，
  // 而那正是要防的事）。layerSlot 是显示真值，visible 与加载圈同一判据（visibleRange）。
  layerSlotRef.current = layerSlot
  visibleRef.current = visibleRange(viewScroll, boxH, viewH, pageCount)

  /**
   * 上下模式：**视口里露出来、但还没有帧的页，直接排一次后台渲染**（走 `bg: true` 的
   * 预绘制通路，因此**自动继承「只写视野外的画布」这条硬约束**，见 spareLayerOffscreen）。
   *
   * 为什么预绘制之外还要这一条：预绘制在队列忙时只能按 300ms 去"重新争取"，而且是
   * 「先等预热到位」才开工；连续拖拽时它几乎抢不到空档，于是手指不停就到不了下一页
   * （真机 2026-10-09）。这条只在**渲染器真的空下来**时补一次，代价是一次取图+画一帧。
   *
   * 不抢在飞/排队的那件：单槽队列被来回顶会变成两页互相挤掉，谁也画不出来。
   */
  useEffect(() => {
    if (!ud) return
    if (inflightRef.current || queuedRef.current) return
    // 可见页比画布还多（缩小 + 宽幅谱）⇒ 写哪块都会顶掉别的可见页，交给常规通路
    if (pending.length > ALL_LAYERS.length - 1) return
    const last = fillLastRef.current
    const skip = last && Date.now() - last.at < 5000 ? last.page : null
    const candidates = skip === null ? pending : pending.filter((p) => p !== skip)
    const next = nextVisibleToRender(candidates, udDirRef.current)
    if (next === null) return
    fillLastRef.current = { page: next, at: Date.now() }
    runJobRef.current({ page: next, zoom: zoomRef.current, bg: true })
    // ⚠️ deps 里的 `pending` 是**每帧新建的数组**，所以这条 effect 实际是「每次渲染都跑」。
    // 2026-10-09 核过，结论是**不动它**：体只有几次比较与一次 filter（微秒级），真正会排
    // 渲染那一步有「队列空着 + 真有页待渲染」两道闸；而「同一页 5 秒后可再试」这条语义
    // 正是靠它顺带跑起来——改成稳定键就必须再补一个重试定时器，净增复杂度、白换风险。
  }, [ud, pending, idleTick, requestRender])

  /**
   * 撤销按钮是否可用：栈非空 **且** 栈顶那一步的页此刻在屏幕上（`renderedPages` = 三块
   * 画布各自装着哪一页，LR 下含前后邻居、UD 下含条上相邻的页）。理由见 canUndo 的注释。
   */
  const undoTopPage = historyRef.current[historyRef.current.length - 1]?.page ?? null
  const undoVisible = undoDepth > 0 && undoTopPage !== null && renderedPages.has(undoTopPage)

  // 双缓冲两块的样式。左右模式：活跃块在 0 位；**滑出中的那块**压在最上层向左/向右移出，
  // 新页在下面被露出来（换帧时新页早已渲好，不违反「宁停上一页也不上白帧」）。
  // 移出距离取「内容框宽 / 视口宽」里的较大者：缩小后内容比视口窄且居中，只移
  // 自己一个宽度会在左边留一条没盖住的旧页。transform 恒给具体值（不用 none）：
  // 「none → 具体值」的插值在部分 WebView 上不稳，会直接跳到终点。
  //
  // 上下模式：不做滑出动画（滚动本身就是连续位移），三块各自摆到**它那一页的纵向偏移**上
  // ——于是上下相邻的页天然接在一起，滚下去时邻居页早已画好并摆在正确的位置。
  const layerStyle = (l: Layer) => {
    const sliding = !ud && turn && turn.layer === l ? turn : null
    const held = ud ? layerPageOf(l) : null
    const visible = ud ? held !== null : activeLayer === l || Boolean(sliding)
    return {
      left: visible ? '0px' : OFFSCREEN,
      top: ud && held !== null ? `${pageTop(held, boxH)}px` : '0px',
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
      {noImages ? (
        // 没有页图：App 里没有可渲染的东西（pdf.js 运行时已拿掉，见文件头的注释）。
        // 给一条真出口 —— 「保存到…」把 PDF 交给用户能看见的地方，功能上仍拿得到这份谱子
        <View className='flex flex-row items-center justify-between px-4 py-2'>
          <Text className='flex-1 text-xs text-text-muted'>{t('scoreReader.noImages')}</Text>
          <View
            className='ml-3 shrink-0 rounded-full border border-border bg-card px-3 py-1'
            onClick={openHandoff}
          >
            <Text className='text-xs text-text'>{t('common.saveTo.title')}</Text>
          </View>
        </View>
      ) : stage === 'error' && message ? (
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
          // ⚠️ `zIndex: 0` 是**有意的**：`position: absolute` + `z-index: auto` **不构成层叠
          // 上下文**，于是里面画布的 z 序（1/3/5）会"逃逸"到页面根，直接和工具条（12）比大小。
          // 真机反馈过「UD 模式下内容把底栏整个盖住」——那正是这层关系出问题的形态。
          // 给它一个显式 z 之后，舞台里的东西整体就是**一层**，工具条/徽标/教程/面板都在它之上，
          // 层序变成确定的，不再依赖"每个画布的 z 恰好比工具条小"这种默契。
          className='absolute inset-0 overflow-hidden'
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
          // 舞台底色 = 采样到的**纸色**：谱面比屏幕矮时（A4 比例的手机屏必然如此）上下会
          // 各留一段，之前露的是页面底色（浅灰）——那道「乐谱与灰带之间的距离」就是它。
          // 与灰带同色之后整屏连成一片，看起来就是一整张谱子
          // ⚠️ `zIndex: 0` 是**有意的**：`position: absolute` + `z-index: auto` **不构成层叠
          // 上下文**，于是里面画布的 z 序（1/3/5）会"逃逸"到页面根，直接和工具条（12）比大小。
          // 真机反馈过「UD 模式下内容把底栏整个盖住」——那正是这层关系出问题的形态。
          // 给它一个显式 z 之后，舞台里的东西整体就是**一层**，工具条/徽标/教程/面板都在它之上，
          // 层序变成确定的，不再依赖"每个画布的 z 恰好比工具条小"这种默契。
          style={{ zIndex: 0, backgroundColor: bandColor?.top }}
        >
          <View
            className='absolute'
            style={{
              left: `${pan.x}px`,
              top: `${pan.y}px`,
              width: `${boxW}px`,
              height: `${contentH}px`,
            }}
          >
            {/* 三块画布：一块显示中、一块放着「下一页」（预绘制）、一块放着「上一页」
                （换帧后退役的那块，内容是刚离开的那页——免费）。渲染永远进「该写的那块」，
                渲完再换帧，清屏那一下就不会露白（见 lib/predraw.ts 与 layerStyle）。
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
            {/* 批注层：**每块页画布各配一层**，position/size 与它那一页完全一致
                （直接复用 layerStyle ⇒ 翻页动画时也跟着滑，笔迹不会掉队）。
                ⚠️ 挂在页画布**之后**：DOM 靠后的压在上面（两块都用 zIndex 1 或 3 时靠顺序）。
                只在该页有笔迹、或画笔打开（准备画）时挂载——没笔迹的页不白占一块画布。
                ⚠️ 不覆盖 layerStyle 的 zIndex：否则翻页动画里（滑出那块 z=3）笔迹会被自己
                那一页盖住。同级 z 时**排在后面的在上**，所以批注层要放在页画布之后。 */}
            {ALL_LAYERS.map((l) =>
              penOn || (annos[String(layerSlot[l] ?? 0)] ?? []).length > 0 ? (
                <Canvas
                  key={l}
                  type='2d'
                  id={`reader-overlay-${l}`}
                  className='absolute top-0 block'
                  style={layerStyle(l)}
                />
              ) : null
            )}
            {/* 还没渲染出来的页：各自中心一个转圈。
                ⚠️ 它们是**内容框的子节点**（内容坐标系），所以样式里**没有 `pan`**——
                滚动时这几个节点的样式一个字节都不变，每帧只有内容框自己在动。
                从前挂在 `#reader-stage` 上、坐标是舞台的（样式里必须加 `pan`）：
                那既是「漏加 pan 就整片错位」这类 bug 的来源（2026-10-09 真机
                「下面一片空白、连加载圈都没有」），也让每个圈的样式逐帧进 setData。
                放内容框里这两件事一起没有了——坐标与画布同源，且逐帧零变化。
                zIndex 5 > 画布的 1/3；DOM 上也排在画布与批注层之后（同级 z 靠后者在上）。 */}
            {pending.map((p) => (
              <View
                key={`pending-${p}`}
                className='absolute flex flex-row justify-center'
                style={{
                  left: '0px',
                  // `pageTop` 只在竖条模式有意义（内容框 = 整条）；LR 的内容框只有一页高，
                  // 圆圈该落在**这一页**（也就是内容框）的中心，取 0 而不是 (p-1)×页高
                  top: `${(ud ? pageTop(p, boxH) : 0) + boxH / 2 - 20}px`,
                  width: `${boxW}px`,
                  zIndex: 5,
                }}
              >
                <View className='score-reader-spinner h-8 w-8 rounded-full border-2' />
              </View>
            ))}
          </View>

          {/* 页码徽标：**固定在屏幕右下角**（不随谱面拖动/缩放走）。
              曾经锚在谱面右下角 ⇒ 谱面在屏幕里垂直居中时它就落在屏幕中部，还会压住
              谱面最后一个谱表的音符（用户 2026-10-08 反馈）。
              − 纯 Text/View，**不引入任何原生组件**（底栏那个跳页 Input 是原生组件，
                它在父级 visibility:hidden 下仍可能漏出来，别在这里重蹈覆辙）；
              − 无底色、只给文字描边（见 index.scss 的 .page-badge-text）：压在任何
                深浅的谱面上都读得清，又不像色块那样挡内容；
              − 菜单开着时也保留：它就是「我在第几页」的常驻提示。 */}
          {pageCount > 0 ? (
            <View className='absolute bottom-2 right-2' style={{ zIndex: Z_PAGE_BADGE }}>
              <Text className='page-badge-text text-xs'>
                {t('scoreReader.pageOf', { page, total: pageCount })}
              </Text>
            </View>
          ) : null}

          {/* ⚠️ 这里**不再画灰带**（用户 2026-10-08 定：菜单关着时不该遮住任何谱面）。
              上下滚动模式里的条是连续的，那两条纸色带会实打实地压住谱面上下沿的内容；
              左右模式虽然纸色与舞台底色同色、看不出来，留着也只是白占一层。
              菜单**打开**时工具条是不透明的（bg-surface），那才是它该有的样子。

              但「点上下边缘＝开关菜单」这个**命中区**在左右模式里保留（见 onTouchStart 的
              band 字段）：工具条就出现在那里，点它会出现的那个位置唤菜单是自然的手势。
              上下模式不保留：那里的分区被定死成 20/60/20（点上下 = 滚动）。 */}

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

        {/* 底栏（悬浮）：五个图标按钮 + 各自的气泡（见 components/score/ReaderToolbar）。
            **顶栏整块去掉**（用户 2026-10-10 定）：页码与缩放搬进气泡，批注与「保存到…」
            成了按钮，教程只剩「首次进入 / 切模式自动弹」。
            菜单关着时 visibility:hidden + pointer-events:none —— 隐藏但**保留布局盒子**
            （`measureStage` 要量它的高度：内容内缩与「点下边缘唤菜单」的命中区都取它） */}
        <View
          id='reader-bottombar'
          className='absolute bottom-0 left-0 right-0 border-t border-border bg-surface'
          style={{
            zIndex: Z_TOOLBAR,
            paddingBottom: SAFE_BOTTOM,
            visibility: menuOn ? 'visible' : 'hidden',
            pointerEvents: menuOn ? 'auto' : 'none',
          }}
        >
          <ReaderToolbar
            dark={dark}
            ud={ud}
            zoom={zoom}
            page={page}
            pageCount={pageCount}
            panel={bottomPanel}
            busy={handoff.busy}
            trackW={trackW}
            onPanel={openPanel}
            onPen={penFromToolbar}
            onForward={openHandoff}
            onMode={switchMode}
            onZoom={handleZoom}
            onJump={gotoPage}
          />
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
              tool={tool}
              onTool={setTool}
              // 撤销按钮只在「栈顶那一步的页**正显示在屏幕上**」时给：撤销弹的是全局栈顶，
              // 从前只看栈深 ⇒ 在没笔迹的页上点它会**静默改掉别页的笔迹**（评审抓出）。
              // 现在每次按下都必然看得见效果。
              canUndo={undoVisible}
              clearPage={page}
              onColor={setPenColor}
              onWidth={setPenWidth}
              onUndo={handleUndo}
              onClear={handleClear}
            />
          </View>
        ) : null}

        {/* 首次教程蒙层：放在最后 ⇒ 压在所有工具条之上（z 也最高）。
            它是 #reader-stage 的兄弟节点，触摸不会冒泡进舞台状态机 */}
        {tutorialOn ? <ReaderTutorial mode={mode} onClose={dismissTutorial} /> : null}
        {handoff.sheetOn ? (
          <SaveToSheet
            kinds={handoff.kinds}
            labels={handoff.labels}
            ready={handoff.ready}
            busy={handoff.busy}
            onPick={handoff.pick}
            onClose={handoff.close}
          />
        ) : null}
      </View>
    </View>
  )
}
