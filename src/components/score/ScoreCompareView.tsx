import { useCallback, useEffect, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { Canvas, Text, View } from '@tarojs/components'
import { supabase } from '@/lib/supabase'
import { useT } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import { pageImageUrls } from '@/lib/score-page-image'
import { mergeStrokes } from '@/lib/annotation-sync'
import type { AnnoStroke } from '@/lib/annotation'
import { drawStrokeOn } from '@/pages/score-reader/lib/anno-draw'
import { loadPageImage, paintPageImage } from '@/pages/score-reader/lib/page-image'
import { rasterDpr } from '@/pages/score-reader/lib/raster'
import { waitForLayoutSize } from '@/pages/score-reader/lib/canvas-size'
import { Z_STATUS } from '@/pages/score-reader/lib/layout'
import type { CanvasNode } from '@/pages/score-reader/lib/types'

export type CompareSide = 'local' | 'remote' | 'merge'

export type ComparePageData = {
  local: AnnoStroke[]
  remote: AnnoStroke[]
  remoteVersion: string | null
}

export type CompareSubmitResult = {
  ok: boolean
  /** 预览之后远端/本地又变了：重新加载预览，让用户重看一眼 */
  raced?: boolean
  message?: string
}

export type ScoreCompareViewProps = {
  fileId: string
  page: number
  /** 阅读器带过来的 PDF 地址；缺了会回退查库（与冲突页同一套） */
  presetUrl: string
  presetName: string
  hint: string
  pageLabel: string
  labels: Record<CompareSide, string>
  submitLabel: string
  defaultSide: CompareSide
  racedText: string
  failedText: string
  loadData: () => Promise<ComparePageData>
  submit: (side: CompareSide, data: ComparePageData) => Promise<CompareSubmitResult>
  /** 提交成功后的去处；缺省 navigateBack（独立页面）。浮层用法传自己的关闭回调 */
  onSuccess?: () => void
  /** 浮层用法的「返回」；常驻页面不传（导航栏已有返回） */
  onCancel?: () => void
}

/**
 * 一页两版预览 + 三选一（本地 / 对照 / 合并）。
 *
 * 从冲突页抽出来的**纯界面**：数据从哪来、提交写到哪，全由调用方通过
 * `loadData` / `submit` 两个适配器给。冲突页（个人 vs 个人远端）与合并页
 * （个人 vs 共享）共用它，避免两份预览/绘制逻辑各自漂移。
 *
 * 交互（2026-10-15 定稿，合并页沿用）：
 *   - 上方实时预览，下方三个单选切版本；
 *   - 一个「使用这一版」提交按钮，作用于当前选中的那一版；
 *   - 合并也能预览（并集的后果只有画出来才看得见）；
 *   - 预览没出来之前一律不许提交（`canResolve`）——盲选一次不可逆的裁决。
 */

const CANVAS_ID = '#conflict-canvas'
const OVERLAY_ID = '#conflict-overlay'
const BOX_ID = '#conflict-box'
const STAGE_ID = '#conflict-stage'

/**
 * 某一版要画的笔迹。`merge` 与提交共用 `mergeStrokes`（同一套去重规则）——
 * 预览与落库各写一份的话，看到的和写下去的不是同一份。
 */
const strokesOf = (s: CompareSide, d: ComparePageData): AnnoStroke[] =>
  s === 'local' ? d.local : s === 'remote' ? d.remote : mergeStrokes(d.local, d.remote)

export function ScoreCompareView({
  fileId,
  page,
  presetUrl,
  presetName,
  hint,
  pageLabel,
  labels,
  submitLabel,
  defaultSide,
  racedText,
  failedText,
  loadData,
  submit,
  onSuccess,
  onCancel,
}: ScoreCompareViewProps) {
  const { t } = useT()
  const darkClass = useThemeClass()

  const [data, setData] = useState<ComparePageData | null>(null)
  const [side, setSide] = useState<CompareSide>(defaultSide)
  const [stage, setStage] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  /** 页面的 CSS 尺寸（按图像比例适配舞台） */
  const [box, setBox] = useState({ w: 0, h: 0 })
  /**
   * 上下两条栏是否展开。点预览区切换（用户 2026-10-15 提，要的是阅读器「点中间」那个手感，
   * 收起后能看见整页）。收起时 stage 占满整屏，谱面还要**按新的可用尺寸重算**。
   */
  const [chromeOn, setChromeOn] = useState(true)

  const pdfUrlRef = useRef('')
  const overlayNodeRef = useRef<CanvasNode | null>(null)
  /** 预览当前显示的那一版笔迹（切开关时只重画这一块，不重新取图） */
  const shownRef = useRef<AnnoStroke[]>([])
  const boxRef = useRef({ w: 0, h: 0 })

  /**
   * 查 **canvas** 节点（要 Node 实例）。
   *
   * ⚠️ `fields({ node: true })` 的 Node 实例**只有 canvas 这类组件给**，普通 View 返回 null
   * ⇒ 这个函数只能喂那两块 canvas；量 View 的尺寸走 `probeSize`。
   */
  const queryCanvasNode = useCallback(
    (sel: string): Promise<CanvasNode> =>
      new Promise((resolve, reject) => {
        Taro.createSelectorQuery()
          .select(sel)
          .fields({ node: true, size: true })
          .exec((res) => {
            const f = res?.[0]
            if (f?.node) resolve(f.node as CanvasNode)
            else reject(new Error(t('scoreReader.conflict.loadFailed')))
          })
      }),
    [t]
  )

  /** 只问**布局尺寸**（普通 View 没有 Node 实例，所以这里**不能**要 `node`） */
  const probeSize = useCallback(
    (sel: string): Promise<{ width: number; height: number } | null> =>
      new Promise((resolve) => {
        Taro.createSelectorQuery()
          .select(sel)
          .boundingClientRect()
          .exec((res) => {
            const r = res?.[0] as { width?: number; height?: number } | null
            resolve(
              r && typeof r.width === 'number'
                ? { width: r.width, height: typeof r.height === 'number' ? r.height : 0 }
                : null
            )
          })
      }),
    []
  )

  /** 只重画批注层（切版本走这条） */
  const paintOverlay = useCallback((strokes: AnnoStroke[]) => {
    const node = overlayNodeRef.current
    const { w, h } = boxRef.current
    if (!node || !(w > 0) || !(h > 0)) return
    const dpr = rasterDpr(w, h)
    node.width = Math.max(1, Math.round(w * dpr))
    node.height = Math.max(1, Math.round(h * dpr))
    const ctx = node.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    for (const s of strokes) drawStrokeOn(ctx, s, w, h)
  }, [])

  /**
   * 取图 + 画上去（首帧）。
   *
   * ⚠️ 画之前要等**布局盒真的等于目标尺寸**（`waitForLayoutSize`）：与阅读器首帧那条
   * 教训同源（2026-10-11 真机「首帧糊色块」= 位图是在视图层还没应用尺寸的那一拍画的）。
   */
  const drawPage = useCallback(async () => {
    const pageNode = await queryCanvasNode(CANVAS_ID)
    const overlayNode = await queryCanvasNode(OVERLAY_ID)
    overlayNodeRef.current = overlayNode

    const stageSize = await probeSize(STAGE_ID)
    const availW = stageSize?.width ?? 0
    const availH = stageSize?.height ?? 0
    if (!(availW > 0) || !(availH > 0)) throw new Error(t('scoreReader.conflict.loadFailed'))

    const img = await loadPageImage(pageNode, pageImageUrls(pdfUrlRef.current, page), {
      // 与阅读器**同一个键**：整册预下载过就直接命中本地文件，一次网络都不用
      key: `${fileId}#${page}`,
    })
    const scale = Math.min(availW / (img.width || 1), availH / (img.height || 1))
    const w = Math.max(1, Math.round((img.width || 1) * scale))
    const h = Math.max(1, Math.round((img.height || 1) * scale))
    boxRef.current = { w, h }
    setBox({ w, h })

    await waitForLayoutSize(() => probeSize(BOX_ID), { width: w, height: h })
    const dpr = rasterDpr(w, h)
    paintPageImage(pageNode, img.img, Math.round(w * dpr), Math.round(h * dpr))
    paintOverlay(shownRef.current)
  }, [fileId, page, paintOverlay, probeSize, queryCanvasNode, t])

  /** 读两份内容并起一帧 */
  const load = useCallback(async () => {
    setStage('loading')
    setMessage('')
    try {
      if (!fileId) throw new Error(t('scoreReader.notFound'))
      if (!pdfUrlRef.current) {
        // 阅读器没带 URL（理论上不会）：自己查一次。存储地址是构建期就定下的，不随会话变
        let url = presetUrl
        if (!url) {
          const { data: row, error } = await supabase
            .from('sheet_music_files')
            .select('storage_path, file_name')
            .eq('id', fileId)
            .maybeSingle()
          if (error) throw new Error(error.message)
          if (!row?.storage_path) throw new Error(t('scoreReader.notFound'))
          url = supabase.storage.from('sheet-music').getPublicUrl(row.storage_path).data.publicUrl
          if (row.file_name) void Taro.setNavigationBarTitle({ title: row.file_name })
        } else if (presetName) {
          void Taro.setNavigationBarTitle({ title: presetName })
        }
        pdfUrlRef.current = url
      }
      const state = await loadData()
      // 预览的第一帧必须就是**当前选中那一版**（合并页默认选的是要引入的那一侧）
      shownRef.current = strokesOf(defaultSide, state)
      setData(state)
      setSide(defaultSide)
      await drawPage()
      setStage('ready')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : failedText)
      setStage('error')
    }
  }, [defaultSide, drawPage, failedText, fileId, loadData, presetName, presetUrl, t])

  useEffect(() => {
    void load()
    // 只跑一次：换页是换一次导航（params 变了就是新页面）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * 点预览区收 / 放上下两条栏。
   *
   * ⚠️ `stage !== 'ready'` 时**不收**：那两条栏里写着「为什么问你」和「重试」，正是加载中 /
   * 失败时唯一的指引 —— 而重试按钮就在 stage 里，点它会冒泡上来一起把栏收掉。
   */
  const toggleChrome = () => {
    if (stage !== 'ready') return
    setChromeOn((v) => !v)
  }

  /** 首次挂载跳过（load() 里已经画过一帧）；之后每次收放都要按新的可用尺寸重算 */
  const chromeInitedRef = useRef(false)
  useEffect(() => {
    if (!chromeInitedRef.current) {
      chromeInitedRef.current = true
      return
    }
    if (stage !== 'ready') return
    // 重算是锦上添花：失败就保持原样，别把整页打成错误态（那是 load 的职责）
    void drawPage().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chromeOn])

  /** 切预览：只重画批注层 */
  const switchSide = (next: CompareSide) => {
    if (!data || next === side) return
    shownRef.current = strokesOf(next, data)
    setSide(next)
    paintOverlay(shownRef.current)
  }

  /**
   * 提交选择。
   *
   * ⚠️ `stage !== 'ready'` 时**一律不执行**：预览画出来之前 `data` 已经有值了，
   * 只挡 `!data` 会留一个「没看见两版也能选」的窗口 —— 页图加载失败（弱网、iOS 那条
   * 已知的失败路径）时它就从窗口变成常态，用户会在盲选之下完成一次不可逆的裁决。
   * 方案 §5：预览是刚需，且**默认不要替用户选**。
   */
  const canResolve = stage === 'ready' && !busy && Boolean(data)
  const resolve = async (choice: CompareSide) => {
    if (!canResolve || !data) return
    setBusy(true)
    setMessage('')
    const result = await submit(choice, data)
    setBusy(false)
    if (result.ok) {
      if (onSuccess) onSuccess()
      else void Taro.navigateBack()
      return
    }
    if (result.raced) {
      // 对照侧在我看预览的时候又变了：不拿旧选择套新内容，刷新预览让用户重看一眼。
      // ⚠️ 顺序不能颠倒：load() 一上来就 setMessage('')，先设的话这句提示一次都画不出来
      await load()
      setMessage(racedText)
      return
    }
    setMessage(result.message ?? failedText)
  }

  return (
    <View
      className={`${darkClass} relative flex min-h-0 flex-col overflow-hidden bg-page-bg`}
      style={{ height: '100vh' }}
    >
      {onCancel ? (
        <View
          className='border-b border-border px-4 pb-2'
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}
          onClick={onCancel}
        >
          <Text className='text-sm text-text'>{t('scoreReader.compareBack')}</Text>
        </View>
      ) : null}
      {chromeOn ? (
        <View className='border-b border-border px-4 py-3'>
          <Text className='block text-xs leading-relaxed text-text-muted'>{hint}</Text>
          <Text className='mt-1 block text-xs text-text-subtle'>{pageLabel}</Text>
        </View>
      ) : null}

      <View
        id='conflict-stage'
        className='relative flex flex-1 items-center justify-center overflow-hidden'
        onClick={toggleChrome}
      >
        <View
          id='conflict-box'
          className='relative'
          style={{ width: `${box.w}px`, height: `${box.h}px` }}
        >
          <Canvas
            type='2d'
            id='conflict-canvas'
            className='absolute left-0 top-0 block bg-page-bg'
            style={{ width: `${box.w}px`, height: `${box.h}px` }}
          />
          <Canvas
            type='2d'
            id='conflict-overlay'
            className='absolute left-0 top-0 block'
            style={{ width: `${box.w}px`, height: `${box.h}px` }}
          />
        </View>
        {stage !== 'ready' ? (
          <View
            className='absolute left-0 right-0 top-0 py-3 text-center'
            style={{ zIndex: Z_STATUS }}
          >
            <Text className='text-xs text-text-muted'>
              {stage === 'error' ? message : t('scoreReader.loading')}
            </Text>
            {stage === 'error' ? (
              <View className='mt-2 flex flex-row justify-center'>
                <View
                  className='rounded-full border border-border bg-card px-3 py-1'
                  onClick={() => void load()}
                >
                  <Text className='text-xs text-text'>{t('scoreReader.retry')}</Text>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {chromeOn ? (
        <View
          className='border-t border-border bg-surface px-4 pt-3'
          /* ⚠️ 底部留白**不能只靠 `pb-safe`**：在没有安全区的机型上它就是 0 ⇒ 提交按钮
             整个贴在页底（用户 2026-10-15 真机）。内联 px 不参与 Taro 的 px→rpx 转换。 */
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
        >
          <View className='mb-3 flex flex-row items-center justify-center'>
            {(['local', 'remote', 'merge'] as CompareSide[]).map((s) => (
              <View
                key={s}
                className={`mr-2 rounded-full border px-4 py-2 ${
                  side === s ? 'border-primary bg-primary/10' : 'border-border bg-card'
                }`}
                onClick={() => switchSide(s)}
              >
                <Text className='text-xs text-text'>{labels[s]}</Text>
              </View>
            ))}
          </View>
          {/* ⚠️ 这里**故意不提示「这一版没有笔迹」**（用户 2026-10-15 定）：要的是「看起来
              怎么样」，不是「有没有」—— 一片空白本身就是那个答案 */}
          {message ? (
            <Text className='mb-3 block text-center text-xs text-danger'>{message}</Text>
          ) : null}
          <View className='flex flex-row'>
            <View
              className={`flex-1 rounded-full border border-border bg-card px-3 py-3 text-center ${
                canResolve ? '' : 'opacity-50'
              }`}
              onClick={() => void resolve(side)}
            >
              <Text className='text-sm text-text'>{submitLabel}</Text>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  )
}
