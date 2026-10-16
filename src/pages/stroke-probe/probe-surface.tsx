import { useRef, useState } from 'react'
import { Canvas, PageContainer, View, WebView } from '@tarojs/components'
import Taro, { useUnload } from '@tarojs/taro'
import { reportClientError } from '@/lib/error-report'

/**
 * ⚠️ **临时诊断件**（2026-10-16 加）：四个结构变体共用这块落笔面，用来回答
 * 「微信那条左沿判定带，跟页面结构有没有关系」。
 *
 * 为什么需要它：真机上量到我们自己的小程序带宽 ≈56px（控制变量：16 笔、向右位移固定在
 * 295–335px、只变起手位置），而同一台机上金山 WPS 的带只有它的 1/5–1/8。同客户端不同宽度
 * ⇒ 带**不是常数**。而官方文档里没有任何能缩窄它的开关（唯一相关的 `fullscreenDrag` 方向相反），
 * 所以差异只可能来自**结构**。四个变体就是拿结构做对照：
 *
 *   A `2d`      —— 全屏 `canvas type="2d"`（同层渲染）+ `disableScroll: true`（≈现在的阅读器）
 *   B `2d`      —— 同 A，但页面**不设** `disableScroll`
 *   C `legacy`  —— 全屏**老式 `canvas-id`**（小程序**原生组件**，另一条渲染路径）
 *   D `webview` —— 全屏 `web-view` 装 H5（金山文档那套形态）
 *   E `2d`      —— 同 A，但页面配置 `navigationStyle: 'custom'`（二手说法称它会禁掉原生右滑返回）
 *   F `2d`      —— 同 A，但页面里**挂一个 `show={false}` 的 `page-container`**（官方文档说页面内存在
 *                  该容器时右滑会去关它；若「挂着不显示」也算数，那就是个零成本开关）
 *   G `catch`   —— 同 A，但整屏画布的 `touchmove` 用 **`catch`** 接（`catchMove`）。小程序里唯一
 *                  对应 Web 端「把这段手势声明成自己的」（`preventDefault` / `touch-action:none`）
 *                  的写法 —— 前六个变体**全是 `bind`**，这一支从没试过。
 *                  背景（2026-10-16 adb 实测，同一台机）：金山文档那条左沿带 ≈55 物理 px
 *                  ≈20 CSS px，止于**他们自己内容的起点**；我们 55 CSS px = 155 物理 px。
 *                  G 要回答的就是：把触摸"认领"下来，能不能把 155 压到 20。
 *
 * 判据全是同一套：**起手 x / 一笔内最长停顿 / 有没有被 `touch-cancel`**。落笔由人做，
 * 读数直接进 dev 库（见下面 `stroke_probe_*`），所以小程序侧不需要人抄数字。
 *
 * **验完就删**：这份文件 + `pages/stroke-probe*` 两个页面 + `app.config.ts` 里那两条路由
 * + 分享面板里那个入口。别把它留在正式线上。
 */
export type ProbeKind = '2d' | 'legacy' | 'webview' | 'pcontainer' | 'catch'

/** H5 探针（`docs/stroke-probe.html`，经 jsDelivr 指我们公开仓库）—— 与 D 变体配对 */
export const PROBE_H5_URL =
  'https://cdn.jsdelivr.net/gh/PKUSO-WebApp/pkuso-mp@dev/docs/stroke-probe.html'

/** 各变体各自的落地 URL —— 探针页右上角那排按钮用它互相切换 */
const VARIANTS: Array<{ v: string; url: string }> = [
  { v: 'A', url: '/pages/stroke-probe/index?v=A&k=2d' },
  { v: 'B', url: '/pages/stroke-probe-free/index?v=B&k=2d' },
  { v: 'C', url: '/pages/stroke-probe/index?v=C&k=legacy' },
  { v: 'D', url: '/pages/stroke-probe/index?v=D&k=webview' },
  { v: 'E', url: '/pages/stroke-probe-custom/index?v=E&k=2d' },
  { v: 'F', url: '/pages/stroke-probe/index?v=F&k=pcontainer' },
  { v: 'G', url: '/pages/stroke-probe/index?v=G&k=catch' },
]

type Diag = {
  startX: number
  startY: number
  lastAt: number
  maxGap: number
  pts: number
  moves: number
  startAt: number
}

export function ProbeSurface({
  kind,
  /** 变体名（A/B/C/D）—— 只进埋点，用来对账 */
  variant,
}: {
  kind: ProbeKind
  variant: string
}) {
  const [hud, setHud] = useState('画一笔看看…')
  const diagRef = useRef<Diag | null>(null)
  const drawingRef = useRef(false)
  const pathRef = useRef<[number, number][]>([])
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const lastPtRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const wRef = useRef(0)
  const hRef = useRef(0)
  /** F/G 与 A 的差别只在于「页面里多挂了容器」或「触摸用 catch 接」，画布本身走 2d 那条路 */
  const is2d = kind === '2d' || kind === 'pcontainer' || kind === 'catch'

  /**
   * 去重闸：C 变体的触摸**可能同时命中老式画布和包着它的 View**（原生组件是否冒泡随渲染路径而异），
   * 那样每个点都会被记两次（`pts`/`moves` 翻倍）。判定用「同一个坐标在 40ms 内重复出现」——
   * 探针只关心**触摸间隔**，丢掉一个孪生样本不影响任何读数。
   */
  const isDup = (t: { clientX: number; clientY: number }) => {
    const x = Math.round(t.clientX)
    const y = Math.round(t.clientY)
    const now = Date.now()
    const l = lastPtRef.current
    lastPtRef.current = { x, y, t: now }
    return !!l && l.x === x && l.y === y && now - l.t < 40
  }

  const report = (outcome: string) => {
    const d = diagRef.current
    if (!d) return
    const ms = Date.now() - d.startAt
    reportClientError({
      event: 'score_reader_stroke_probe',
      message: `[${variant}/${kind}] 起手 x=${d.startX} 停顿 ${d.maxGap}ms 点数 ${d.pts} ${outcome}`,
      detail: {
        variant,
        kind,
        startX: d.startX,
        startY: d.startY,
        maxGapMs: d.maxGap,
        pts: d.pts,
        moves: d.moves,
        spanMs: ms,
        outcome,
        // 布局事实：带宽是不是「屏宽的一个比例」得靠它对账
        windowWidth: wRef.current,
        windowHeight: hRef.current,
        pixelRatio: Taro.getSystemInfoSync().pixelRatio,
      },
    })
    setHud(
      `起手 x=${d.startX}　最长停顿 ${d.maxGap}ms\n点数 ${d.pts}　结局 ${outcome}\n（${variant} 变体）`
    )
    diagRef.current = null
  }

  // 手势真把页面返回了 ⇒ 上面那条 summary 之后还会来一条这个（对账用）
  useUnload(() => {
    reportClientError({
      event: 'score_reader_stroke_probe_unload',
      message: `[${variant}/${kind}] 页面被销毁（手势返回？）`,
      detail: { variant, kind },
    })
  })

  const onTouchStart = (e: any) => {
    const t = e.touches?.[0]
    if (!t) return
    if (isDup(t)) return
    if (!diagRef.current) {
      const info = Taro.getSystemInfoSync()
      wRef.current = info.windowWidth
      hRef.current = info.windowHeight
    }
    diagRef.current = {
      startX: Math.round(t.clientX),
      startY: Math.round(t.clientY),
      lastAt: 0,
      maxGap: 0,
      pts: 1,
      moves: 0,
      startAt: Date.now(),
    }
    pathRef.current = [[t.clientX, t.clientY]]
    drawingRef.current = true
    void ensureCtx().then(() => paint())
  }

  const onTouchMove = (e: any) => {
    const d = diagRef.current
    const t = e.touches?.[0]
    if (!d || !t) return
    if (isDup(t)) return
    const now = Date.now()
    if (d.lastAt > 0) {
      const gap = now - d.lastAt
      if (gap > d.maxGap) d.maxGap = gap
    }
    d.lastAt = now
    d.moves += 1
    d.pts += 1
    pathRef.current.push([t.clientX, t.clientY])
    paint()
  }

  const onTouchEnd = () => {
    if (drawingRef.current) {
      drawingRef.current = false
      report('lift')
    }
  }
  const onTouchCancel = () => {
    if (drawingRef.current) {
      drawingRef.current = false
      report('cancelled')
    }
  }

  /** 2d 画布：取一次节点（这一步本身也要 ~100ms，但探针只关心**触摸间隔**，不关心它） */
  const ensureCtx = () =>
    new Promise<void>((resolve) => {
      if (ctxRef.current || !is2d) return resolve()
      Taro.createSelectorQuery()
        .select('#probe-2d')
        .fields({ node: true, size: true })
        .exec((res) => {
          const node = res?.[0]?.node
          if (!node) return resolve()
          const dpr = res[0].width ? node.width / res[0].width : 1
          const ctx = node.getContext('2d')
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.lineWidth = 2
          ctx.lineJoin = 'round'
          ctx.lineCap = 'round'
          ctx.strokeStyle = '#e5484d'
          ctxRef.current = ctx as CanvasRenderingContext2D
          resolve()
        })
    })

  const paint = () => {
    const pts = pathRef.current
    if (is2d) {
      const ctx = ctxRef.current
      if (!ctx || pts.length < 2) return
      ctx.beginPath()
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
      ctx.stroke()
      return
    }
    if (kind === 'legacy') {
      // 老式画布：整条重画（`draw()` 才是真正上屏那一下）
      const ctx = Taro.createCanvasContext('probe-old')
      ctx.setLineWidth(2)
      ctx.setLineCap('round')
      ctx.setStrokeStyle('#e5484d')
      if (pts.length >= 2) {
        ctx.beginPath()
        pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
        ctx.stroke()
      }
      ctx.draw()
    }
  }

  /**
   * 读数与变体切换都放**右侧**：探针量的是**左沿**，任何压在左边的东西都会吃掉那一带的
   * 触摸（工具条那次的教训），所以左边一条必须干干净净。读数框本身 `pointerEvents: none`
   *（它只是文字）。
   */
  const hudBox = (
    <>
      <View
        className='absolute right-0 top-0 flex flex-row bg-yellow-200 px-1 py-1 text-xs'
        style={{ zIndex: 90 }}
      >
        {VARIANTS.map((x) => (
          <View
            key={x.v}
            className={`ml-1 px-2 py-1 ${x.v === variant ? 'bg-black text-white' : 'bg-white'}`}
            onClick={() => void Taro.redirectTo({ url: x.url })}
          >
            {x.v}
          </View>
        ))}
      </View>
      <View
        className='absolute bottom-0 right-0 bg-yellow-200 px-2 py-1 text-xs'
        style={{ zIndex: 90, pointerEvents: 'none' }}
      >
        {hud}
      </View>
    </>
  )

  if (kind === 'webview') {
    return (
      <View className='fixed left-0 right-0 top-0 bottom-0'>
        {/* H5 自己画、自己显示读数；它还会经 postMessage 把最近几笔捎回来。
            ⚠️ 两个已知事实：① 开发版打开「调试」时微信会跳过业务域名校验，所以这个跨域
            地址能用（正式版不行 —— 探针验完就删，不进正式版）；② `web-view` 是**原生组件**，
            盖在它上面的普通 View 看不见 ⇒ 这一页的读数与切换按钮实际都被它挡住，
            看 H5 自己那块黄条，退出用系统返回。 */}
        <WebView
          src={PROBE_H5_URL}
          onMessage={(e) => {
            const last = (e.detail?.data ?? [])[0]
            setHud(`H5 读数（postMessage）\n${JSON.stringify(last ?? {})}`)
            reportClientError({
              event: 'score_reader_stroke_probe_h5',
              message: `[${variant}/webview] H5 探针数据`,
              detail: { variant, kind, h5: e.detail?.data ?? null },
            })
          }}
        />
        {hudBox}
      </View>
    )
  }

  return (
    <View
      className='fixed left-0 right-0 top-0 bottom-0'
      // G：`catchMove` = 这层用 `catch:touchmove` 接（不再往页面冒泡）—— 小程序里唯一对应
      // Web 端 `preventDefault` / `touch-action:none` 的"把这段手势声明成自己的"的写法
      catchMove={kind === 'catch'}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
    >
      {is2d ? (
        <Canvas
          id='probe-2d'
          type='2d'
          className='absolute left-0 top-0 h-full w-full'
          style={{ width: '100%', height: '100%' }}
        />
      ) : (
        // 老式画布（原生组件）：**触摸挂在它自己身上** —— 那样才测得到「落在原生组件上的触摸」
        <Canvas
          canvasId='probe-old'
          className='absolute left-0 top-0 h-full w-full'
          style={{ width: '100%', height: '100%' }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
        />
      )}
      {/* F：挂着不显示。要测的是「页面里存在该容器」这件事本身有没有效果（官方只说
          「页面内存在该容器时右滑会去关它」，没说要不要 show） */}
      {kind === 'pcontainer' && <PageContainer show={false} />}
      {hudBox}
    </View>
  )
}
