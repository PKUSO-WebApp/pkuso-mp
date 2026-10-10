import { useRef, useState } from 'react'
import { View, Text, Button, Image } from '@tarojs/components'
import type { ITouchEvent } from '@tarojs/components'
import { useT } from '@/i18n'
import { pageFromSliderX, sliderFracOf } from '@/pages/score-reader/lib/layout'
import bookOpenIcon from '@/assets/icons/book-open.png'
import bookOpenIconDark from '@/assets/icons/book-open-dark.png'
import zoomInIcon from '@/assets/icons/zoom-in.png'
import zoomInIconDark from '@/assets/icons/zoom-in-dark.png'
import pencilLineIcon from '@/assets/icons/pencil-line.png'
import pencilLineIconDark from '@/assets/icons/pencil-line-dark.png'
import forwardIcon from '@/assets/icons/forward.png'
import forwardIconDark from '@/assets/icons/forward-dark.png'
import chevronsLR from '@/assets/icons/chevrons-left-right.png'
import chevronsLRDark from '@/assets/icons/chevrons-left-right-dark.png'
import chevronsUD from '@/assets/icons/chevrons-up-down.png'
import chevronsUDDark from '@/assets/icons/chevrons-up-down-dark.png'

/** 底栏上方那个气泡此刻开的是哪一个（同时只能开一个） */
export type ReaderPanel = 'none' | 'page' | 'zoom'

const ICON = 18
/**
 * 每个按钮是**方形热区**（44px 见方 = 舒适的最小点击尺寸），图标居中，**无底无框**
 * （用户 2026-10-10 定：不要圆角矩形按钮）。整个方形都响应点击。
 *
 * 因此按钮**没有激活态外观**——底色/边框正是被去掉的东西。状态在别处照样看得见：
 * 面板开着时它就在按钮正上方，批注开着时上方会出现整条批注工具条。
 * `busy` 时的半透明是另一回事（那是「点不动」，不是「选中」），保留。
 */
const BTN_SIZE = 44
/** ± 按钮宽度：**必须定宽**，轨道的左端才是可算的常量（见 TRACK_LEFT） */
const STEP_W = 30
const CARD_PAD = 12
const GAP = 12
/** 底栏按钮行的左右内边距 */
const BAR_PAD = 8
/**
 * 轨道左端在**屏幕坐标**里的位置 —— 一个**常量**，不是量出来的。
 *
 * 页码气泡贴屏幕左沿（底栏本身就在屏幕左沿，气泡 `left: 0`），所以
 * 「屏幕左沿 + 卡片内边距 + − 按钮宽 + 间距」就是轨道左端。拖动定位因此完全不依赖
 * `createSelectorQuery` 的测量值 —— 上一版用测量值算，那个值一旦不对，**两个气泡会
 * 一起被压窄**（真机现象：页码条只剩数字、缩放那排被挤成一团）。
 */
const TRACK_LEFT = CARD_PAD + STEP_W + GAP
/** 卡片宽度：全由常量与轨道宽算出，不靠内容撑（内容撑宽 + 居中在真机上出过偏差） */
const cardWidthOf = (trackW: number) => trackW + (STEP_W + GAP) * 2 + CARD_PAD * 2
/** 缩放百分比文字的定宽：不定的话 100% → 95% 会让整排按钮跟着挪（真机反馈） */
const PCT_W = 46

/**
 * 阅读器底栏：五个图标按钮 + 它们各自的气泡。
 *
 * **为什么单独一个组件**：进度条拖动时用组件内 state 更新滑块位置 —— 若这些 state 挂在
 * 阅读器页面上，每动一格都会把整个页面（含三块画布）重渲染一遍，正是 pan-queue 治理过的
 * 那条慢链路。放这里，拖动只重渲染这几十个节点。
 *
 * 各按钮：
 *  1. book-open → 页码气泡（**贴屏幕左沿**，与第一个 icon 同起）：一条**固定宽度**
 *     （屏幕宽的 2/5）的进度条，可拖 + 两侧 ±1 页；
 *  2. zoom-in  → 缩放气泡（**锚在它自己那个按钮上**，左端对齐图标）；
 *  3. pencil   → 批注（外层的批注工具条不变，仍悬在底栏之上）；
 *  4. forward  → 「保存到…」面板（与顶栏原来的那个是同一件事）；
 *  5. 翻页方式 → 图标显示的是**点下去会变成什么**：UD 时给左右箭头、LR 时给上下箭头。
 */
export function ReaderToolbar({
  dark,
  ud,
  zoom,
  page,
  pageCount,
  panel,
  busy,
  trackW,
  onPanel,
  onPen,
  onForward,
  onMode,
  onZoom,
  onJump,
}: {
  dark: boolean
  ud: boolean
  zoom: number
  page: number
  pageCount: number
  panel: ReaderPanel
  /** 交付面板正在忙（防连点） */
  busy: boolean
  /**
   * 进度条轨道宽度（px，屏幕宽的 2/5）。阅读器用**同步**的 `getWindowInfo().windowWidth`
   * 算 —— **不能用舞台的测量值**：量出来的值一旦不可靠，两个气泡会一起被压窄。
   */
  trackW: number
  onPanel: (p: ReaderPanel) => void
  onPen: () => void
  onForward: () => void
  onMode: () => void
  onZoom: (kind: 'in' | 'out' | 'fit') => void
  onJump: (page: number) => void
}) {
  const { t } = useT()
  /**
   * 拖动中的页码（抬手前**不**真的翻页）：只在这一格变了才 setState ——
   * 逐像素更新会把拖一次变成上百次重渲染，而页码变一次才需要重画滑块。
   */
  const [dragPage, setDragPage] = useState<number | null>(null)
  const shown = dragPage ?? page
  const dragRef = useRef<number | null>(null)

  /** 触点在轨道里的位置：左端是常量 TRACK_LEFT，不需要量任何东西 */
  const pageAt = (clientX: number) => pageFromSliderX(clientX - TRACK_LEFT, trackW, pageCount)

  const onSlideStart = (e: ITouchEvent) => {
    const touch = e.touches[0]
    if (!touch) return
    const p = pageAt(touch.clientX)
    dragRef.current = p
    setDragPage(p)
  }
  const onSlideMove = (e: ITouchEvent) => {
    const touch = e.touches[0]
    if (!touch) return
    const p = pageAt(touch.clientX)
    if (p === dragRef.current) return
    dragRef.current = p
    setDragPage(p)
  }
  const onSlideEnd = () => {
    const p = dragRef.current
    dragRef.current = null
    setDragPage(null)
    if (p != null) onJump(p)
  }

  const icon = (src: string, srcDark: string) => (
    <Image src={dark ? srcDark : src} style={{ width: `${ICON}px`, height: `${ICON}px` }} />
  )

  const frac = sliderFracOf(shown, pageCount)
  const cardStyle = {
    width: `${cardWidthOf(trackW)}px`,
    marginBottom: '8px',
    padding: `10px ${CARD_PAD}px`,
  }
  const cellStyle = { width: `${BTN_SIZE}px`, height: `${BTN_SIZE}px` }

  return (
    <>
      {/* 页码气泡：**贴屏幕左沿**（底栏本身就在左沿）⇒ 左端与第一个 icon 同起 */}
      {panel === 'page' ? (
        <View style={{ position: 'absolute', left: '0px', bottom: '100%' }}>
          <View className='rounded-2xl border border-border bg-surface' style={cardStyle}>
            <View
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Button
                className='rounded-full border border-border bg-card py-0.5 text-center text-sm text-text'
                style={{ width: `${STEP_W}px` }}
                disabled={pageCount <= 0 || shown <= 1}
                onClick={() => onJump(shown - 1)}
              >
                −
              </Button>
              {/* 轨道：拖动改页码。宽度固定（屏幕宽的 2/5），**不随页数变化**；
                  左端 = TRACK_LEFT（常量）⇒ 触点到页码是一步纯换算 */}
              <View
                className='relative flex flex-row items-center'
                style={{ width: `${trackW}px`, height: '28px', marginLeft: `${GAP}px` }}
                onTouchStart={onSlideStart}
                onTouchMove={onSlideMove}
                onTouchEnd={onSlideEnd}
                onTouchCancel={onSlideEnd}
              >
                <View className='h-1 w-full rounded-full bg-border' />
                <View
                  className='absolute left-0 h-1 rounded-full bg-primary'
                  style={{ width: `${frac * trackW}px` }}
                />
                <View
                  className='absolute rounded-full border-2 border-primary bg-card'
                  style={{
                    left: `${frac * trackW}px`,
                    width: '14px',
                    height: '14px',
                    marginLeft: '-7px',
                  }}
                />
              </View>
              <Button
                className='rounded-full border border-border bg-card py-0.5 text-center text-sm text-text'
                style={{ width: `${STEP_W}px`, marginLeft: `${GAP}px` }}
                disabled={pageCount <= 0 || shown >= pageCount}
                onClick={() => onJump(shown + 1)}
              >
                +
              </Button>
            </View>
            {/* 数字放气泡里：进度条本身只说「大概在哪」，要知道确切页码得有个数 */}
            <Text className='mt-1 block text-center text-xs text-text-muted'>
              {pageCount > 0 ? t('scoreReader.pageOf', { page: shown, total: pageCount }) : ''}
            </Text>
          </View>
        </View>
      ) : null}

      {/* 五个按钮：等距铺开。每个都是方形热区（无底无框），整个方形可点 */}
      <View
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: `${BAR_PAD}px`,
          paddingRight: `${BAR_PAD}px`,
        }}
      >
        <View
          className='flex flex-row items-center justify-center'
          style={cellStyle}
          ariaLabel={t('scoreReader.pageJump')}
          onClick={() => onPanel(panel === 'page' ? 'none' : 'page')}
        >
          {icon(bookOpenIcon, bookOpenIconDark)}
        </View>

        {/* 缩放按钮与它的气泡**同处一个相对定位的格子里** ⇒ 气泡左端天然对齐图标位置，
            不需要知道这个按钮在屏幕上的 x（弹性布局怎么排都不会错位） */}
        <View style={{ position: 'relative' }}>
          {panel === 'zoom' ? (
            <View style={{ position: 'absolute', left: '0px', bottom: `${BTN_SIZE}px` }}>
              <View
                className='flex flex-row items-center justify-center rounded-2xl border border-border bg-surface'
                style={cardStyle}
              >
                <Button
                  className='rounded-full border border-border bg-card py-0.5 text-center text-sm text-text'
                  style={{ width: `${STEP_W}px` }}
                  ariaLabel={t('scoreReader.zoomOut')}
                  onClick={() => onZoom('out')}
                >
                  −
                </Button>
                {/* 定宽：否则 100% → 95% 时整排会跟着挪（真机反馈「内容随放大缩小改变」） */}
                <Text
                  className='text-center text-xs text-text-muted'
                  style={{ width: `${PCT_W}px`, marginLeft: `${GAP}px` }}
                >
                  {Math.round(zoom * 100)}%
                </Text>
                <Button
                  className='rounded-full border border-border bg-card px-3 py-0.5 text-sm text-text'
                  style={{ marginLeft: `${GAP}px` }}
                  ariaLabel={t('scoreReader.zoomReset')}
                  onClick={() => onZoom('fit')}
                >
                  {t('scoreReader.zoomReset')}
                </Button>
                <Button
                  className='rounded-full border border-border bg-card py-0.5 text-center text-sm text-text'
                  style={{ width: `${STEP_W}px`, marginLeft: `${GAP}px` }}
                  ariaLabel={t('scoreReader.zoomIn')}
                  onClick={() => onZoom('in')}
                >
                  +
                </Button>
              </View>
            </View>
          ) : null}
          <View
            className='flex flex-row items-center justify-center'
            style={cellStyle}
            ariaLabel={t('scoreReader.zoomPanel')}
            onClick={() => onPanel(panel === 'zoom' ? 'none' : 'zoom')}
          >
            {icon(zoomInIcon, zoomInIconDark)}
          </View>
        </View>

        <View
          className='flex flex-row items-center justify-center'
          style={cellStyle}
          ariaLabel={t('scoreReader.annotation')}
          onClick={onPen}
        >
          {icon(pencilLineIcon, pencilLineIconDark)}
        </View>
        <View
          className={`flex flex-row items-center justify-center ${busy ? 'opacity-50' : ''}`}
          style={cellStyle}
          ariaLabel={t('common.saveTo.title')}
          onClick={onForward}
        >
          {icon(forwardIcon, forwardIconDark)}
        </View>
        {/* 图标显示的是**点下去会变成什么**：UD 时给左右箭头（点了就横着翻） */}
        <View
          className='flex flex-row items-center justify-center'
          style={cellStyle}
          ariaLabel={t('scoreReader.modeSwitch')}
          onClick={onMode}
        >
          {ud ? icon(chevronsLR, chevronsLRDark) : icon(chevronsUD, chevronsUDDark)}
        </View>
      </View>
    </>
  )
}
