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

/**
 * 气泡卡片的宽度**显式算出来**，不靠内容撑。
 *
 * 踩过的坑（真机反馈「靠左 + 太窄 + 页码只看得见半个」）：卡片原来是「由内容撑宽 +
 * 外层 `items-center` 居中」——而弹性列默认 `align-items: stretch`，那条居中类一旦
 * 没生效，卡片与行内容就一起贴左，文字也会被挤掉。宽度自己算 + `margin: auto` 居中，
 * 这两件事就都不依赖类的编译结果了。
 */
const CARD_PAD = 12
const cardWidthOf = (trackW: number) => trackW + STEP_W * 2 + CARD_PAD * 2
/**
 * 进度条两侧 ± 按钮的宽度：**必须定宽**。轨道是靠「两侧等宽 + 卡片居中」才正好落在
 * 屏幕中央的，而 `slider.left` 正是按居中去算的（见 index.tsx 传给本组件的 slider）——
 * ± 宽度不等，算出来的轨道左端就是错的，拖到哪都差几像素。
 */
const STEP_W = 30
/**
 * 阅读器底栏：五个图标按钮 + 它们各自的气泡。
 *
 * **为什么单独一个组件**：进度条拖动时用组件内 state 更新滑块位置 —— 若这些 state 挂在
 * 阅读器页面上，每动一格都会把整个页面（含三块画布）重渲染一遍，正是 pan-queue 治理过的
 * 那条慢链路。放这里，拖动只重渲染这几十个节点。
 *
 * 各按钮：
 *  1. book-open → 页码气泡：一条**固定宽度**（屏幕宽的 2/5）的进度条，可拖 + 两侧 ±1 页；
 *  2. zoom-in  → 缩放气泡：− / 适配 / +；
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
  slider,
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
  /** 进度条轨道在**屏幕坐标**里的位置（阅读器算好传进来——它已经量过舞台） */
  slider: { left: number; width: number }
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

  const pageAt = (clientX: number) =>
    pageFromSliderX(clientX - slider.left, slider.width, pageCount)

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

  return (
    <>
      {/* 页码气泡：位置**居中**、轨道宽度固定（页数越多每格越小，见 sliderFracOf） */}
      {panel === 'page' ? (
        <View style={{ position: 'absolute', left: '0px', right: '0px', bottom: '100%' }}>
          <View
            className='rounded-2xl border border-border bg-surface'
            style={{
              width: `${cardWidthOf(slider.width)}px`,
              marginLeft: 'auto',
              marginRight: 'auto',
              marginBottom: '8px',
              padding: `10px ${CARD_PAD}px`,
            }}
          >
            <View style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
              <Button
                className='rounded-full border border-border bg-card py-0.5 text-center text-sm text-text'
                style={{ width: `${STEP_W}px` }}
                disabled={pageCount <= 0 || shown <= 1}
                onClick={() => onJump(shown - 1)}
              >
                −
              </Button>
              {/* 轨道：拖动改页码。宽度由外部给定（屏幕宽的 2/5），**不随页数变化** */}
              <View
                className='relative mx-3 flex flex-row items-center'
                style={{ width: `${slider.width}px`, height: '28px' }}
                onTouchStart={onSlideStart}
                onTouchMove={onSlideMove}
                onTouchEnd={onSlideEnd}
                onTouchCancel={onSlideEnd}
              >
                <View className='h-1 w-full rounded-full bg-border' />
                <View
                  className='absolute left-0 h-1 rounded-full bg-primary'
                  style={{ width: `${frac * slider.width}px` }}
                />
                <View
                  className='absolute rounded-full border-2 border-primary bg-card'
                  style={{
                    left: `${frac * slider.width}px`,
                    width: '14px',
                    height: '14px',
                    marginLeft: '-7px',
                  }}
                />
              </View>
              <Button
                className='rounded-full border border-border bg-card py-0.5 text-center text-sm text-text'
                style={{ width: `${STEP_W}px` }}
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

      {/* 缩放气泡 */}
      {panel === 'zoom' ? (
        <View style={{ position: 'absolute', left: '0px', right: '0px', bottom: '100%' }}>
          <View
            className='flex flex-row items-center justify-center rounded-2xl border border-border bg-surface'
            style={{
              width: `${cardWidthOf(slider.width)}px`,
              marginLeft: 'auto',
              marginRight: 'auto',
              marginBottom: '8px',
              padding: `10px ${CARD_PAD}px`,
            }}
          >
            <Button
              className='rounded-full border border-border bg-card px-3 py-0.5 text-sm text-text'
              ariaLabel={t('scoreReader.zoomOut')}
              onClick={() => onZoom('out')}
            >
              −
            </Button>
            <Text className='mx-3 text-xs text-text-muted'>{Math.round(zoom * 100)}%</Text>
            <Button
              className='rounded-full border border-border bg-card px-3 py-0.5 text-sm text-text'
              ariaLabel={t('scoreReader.zoomReset')}
              onClick={() => onZoom('fit')}
            >
              {t('scoreReader.zoomReset')}
            </Button>
            <Button
              className='ml-2 rounded-full border border-border bg-card px-3 py-0.5 text-sm text-text'
              ariaLabel={t('scoreReader.zoomIn')}
              onClick={() => onZoom('in')}
            >
              +
            </Button>
          </View>
        </View>
      ) : null}

      {/* 五个按钮：等距铺开。每个都是独立的圆角按钮（与原来顶栏那排同一套形状） */}
      <View className='flex flex-row items-center justify-between px-2'>
        <View
          className='flex flex-row items-center justify-center'
          style={{ width: `${BTN_SIZE}px`, height: `${BTN_SIZE}px` }}
          ariaLabel={t('scoreReader.pageJump')}
          onClick={() => onPanel(panel === 'page' ? 'none' : 'page')}
        >
          {icon(bookOpenIcon, bookOpenIconDark)}
        </View>
        <View
          className='flex flex-row items-center justify-center'
          style={{ width: `${BTN_SIZE}px`, height: `${BTN_SIZE}px` }}
          ariaLabel={t('scoreReader.zoomPanel')}
          onClick={() => onPanel(panel === 'zoom' ? 'none' : 'zoom')}
        >
          {icon(zoomInIcon, zoomInIconDark)}
        </View>
        <View
          className='flex flex-row items-center justify-center'
          style={{ width: `${BTN_SIZE}px`, height: `${BTN_SIZE}px` }}
          ariaLabel={t('scoreReader.annotation')}
          onClick={onPen}
        >
          {icon(pencilLineIcon, pencilLineIconDark)}
        </View>
        <View
          className={`flex flex-row items-center justify-center ${busy ? 'opacity-50' : ''}`}
          style={{ width: `${BTN_SIZE}px`, height: `${BTN_SIZE}px` }}
          ariaLabel={t('common.saveTo.title')}
          onClick={onForward}
        >
          {icon(forwardIcon, forwardIconDark)}
        </View>
        {/* 图标显示的是**点下去会变成什么**：UD 时给左右箭头（点了就横着翻） */}
        <View
          className='flex flex-row items-center justify-center'
          style={{ width: `${BTN_SIZE}px`, height: `${BTN_SIZE}px` }}
          ariaLabel={t('scoreReader.modeSwitch')}
          onClick={onMode}
        >
          {ud ? icon(chevronsLR, chevronsLRDark) : icon(chevronsUD, chevronsUDDark)}
        </View>
      </View>
    </>
  )
}
