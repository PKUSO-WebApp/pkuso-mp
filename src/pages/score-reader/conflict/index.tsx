import { useCallback, useEffect, useRef, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { Canvas, Text, View } from '@tarojs/components'
import { supabase } from '@/lib/supabase'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import {
  loadConflictPage,
  resolveAnnotationConflict,
  type ConflictPageState,
} from '@/lib/annotation-sync-runner'
import { pageImageUrls } from '@/lib/score-page-image'
import { mergeStrokes } from '@/lib/annotation-sync'
import type { AnnoStroke } from '@/lib/annotation'
import { drawStrokeOn } from '../lib/anno-draw'
import { loadPageImage, paintPageImage } from '../lib/page-image'
import { rasterDpr } from '../lib/raster'
import { waitForLayoutSize } from '../lib/canvas-size'
import { Z_STATUS } from '../lib/layout'
import type { CanvasNode } from '../lib/types'
import './index.scss'

/**
 * 批注冲突解决页：**一页两版，选一版留下**。
 *
 * 为什么是独立一页而不是阅读器里的一块浮层：这里要的是「看清这一页到底有两份什么笔迹」，
 * 而阅读器那套三画布 + 手势 + 预绘制的机器是为一整册连续翻阅服务的（2649 行）。这一页只画
 * **一页**（LR 的样子），复用两个现成的模块就够：`lib/page-image`（取图，含整册预下载的本地
 * 命中）与 `lib/anno-draw`（笔迹绘制）。两边画出来的一模一样，因为它们本来就是同一份实现。
 *
 * 交互（2026-10-15 定稿）：
 *   - 上方：这一页的**实时预览**，下方三个单选切「本地版 / 远端版 / 合并两版」；
 *   - 下方：一个「使用这一版」提交按钮，作用于**当前选中的那一版**。
 *   - **合并也能预览**：它是两版并集（用户 2026-10-15 定的语义），后果只有画出来才看得见
 *     —— 这个模型没有 per-stroke id / 墓碑 ⇒「一边画了 X、另一边把 X 擦了」分不清，
 *     并集会把擦掉的那笔带回来。看得见再点，是这一页存在的理由。
 *   - **两边都不丢**：选了本地，云端那份进服务端历史（推送 RPC 覆盖时归档）；
 *     选了远端，本地这份也会**先送进历史**（`archive_sheet_music_annotation`）再覆盖本地；
 *     选了合并，被顶掉的云端那份由推送 RPC 归档、本地那份的内容本来就在并集里。
 *     所以「都保留」不需要单独一个按钮 —— 它本来就是默认结果。
 *   - 「稍后处理」**不在这一页**（2026-10-15 去掉：与导航栏返回同义）；入口弹层里那份留着。
 *
 * ⚠️ 一切都以**预览时看到的那个云端版本**为前提：用户看预览的时候云端若又变了，
 * 这一页**什么都不做**，只提示重新看一眼。拿旧选择去套新内容，等于让用户为一个他没见过的
 * 版本做决定。
 */

const CANVAS_ID = '#conflict-canvas'
const OVERLAY_ID = '#conflict-overlay'
const BOX_ID = '#conflict-box'
const STAGE_ID = '#conflict-stage'

type Side = 'local' | 'remote' | 'merge'

/**
 * 某一版要画的笔迹。
 *
 * `'merge'` 走 `mergeStrokes`——**与提交那条路是同一个函数**，这一点不能松：预览与提交
 * 各写一份的话，看到的和落库的就不是同一份（去重规则尤其容易在这里漂）。
 * 合并也能预览是刻意的：并集的后果（被擦掉的那笔会回来）只有画出来才看得见。
 */
const strokesOf = (s: Side, d: ConflictPageState): AnnoStroke[] =>
  s === 'local' ? d.local : s === 'remote' ? d.remote : mergeStrokes(d.local, d.remote)

export default function AnnotationConflict() {
  const { t } = useT()
  // 顶栏：标题走 useNavTitle（它同时负责主题切换时的导航栏配色）；拿到文件名之后再盖成文件名
  useNavTitle('scoreReader.conflict.navTitle')
  const darkClass = useThemeClass()
  const router = useRouter()
  const fileId = router.params.file_id ? decodeURIComponent(router.params.file_id) : ''
  const page = Math.max(1, Number(router.params.page) || 1)
  /** 这一册的 PDF 公开地址（阅读器带过来的；缺了回退查库，见 load） */
  const presetUrl = router.params.u ? decodeURIComponent(router.params.u) : ''
  const presetName = router.params.fn ? decodeURIComponent(router.params.fn) : ''

  const [data, setData] = useState<ConflictPageState | null>(null)
  const [side, setSide] = useState<Side>('local')
  const [stage, setStage] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  /** 页面的 CSS 尺寸（按图像比例适配舞台） */
  const [box, setBox] = useState({ w: 0, h: 0 })
  /**
   * 上下两条栏是否展开。点预览区切换（用户 2026-10-15 提，要的是阅读器「点中间」那个手感，
   * 收起后能看见整页）。收起时 stage 占满整屏，谱面还要**按新的可用尺寸重算** ——
   * 不重算只是四周多出空白，反而看不到更多内容。
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
   * 阅读器那边一直是分开的两个函数（`index.tsx` 的 `queryCanvasNode` / `probeCanvasSize`），
   * 这里曾经把它们混成一个 —— 于是拿它去查 `#conflict-stage` 恒落进 else 分支，
   * 整页直接进「读不到这一页的内容」的错误态（2026-10-15 真机）。
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

  /**
   * 只问**布局尺寸**（普通 View 没有 Node 实例，所以这里**不能**要 `node`）。
   *
   * 用 `boundingClientRect` —— 与阅读器量 `#reader-stage` 同一条路。拿不到返回 **null 而不抛**：
   * `waitForLayoutSize` 的 probe 契约就是「拿不到给 null，照画不误」。
   */
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

  /** 只重画批注层（切「本地版 / 云端版」走这条） */
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
   * ⚠️ 画之前要等**布局盒真的等于目标尺寸**（`waitForLayoutSize`）：这与阅读器首帧那条
   * 教训同源（2026-10-11 真机「首帧糊色块」= 位图是在视图层还没应用尺寸的那一拍画的）。
   * 顺带它保证了那次 setData 已经落地 —— 画布此刻的位置就是最终位置。
   */
  const drawPage = useCallback(async () => {
    const pageNode = await queryCanvasNode(CANVAS_ID)
    const overlayNode = await queryCanvasNode(OVERLAY_ID)
    overlayNodeRef.current = overlayNode

    // 舞台可用尺寸（减掉上下那两块的固定高度由 flex 布局负责，这里量的是它剩下的）
    const stageSize = await probeSize(STAGE_ID)
    const availW = stageSize?.width ?? 0
    const availH = stageSize?.height ?? 0
    if (!(availW > 0) || !(availH > 0)) throw new Error(t('scoreReader.conflict.loadFailed'))

    const img = await loadPageImage(pageNode, pageImageUrls(pdfUrlRef.current, page), {
      // 与阅读器**同一个键**：整册预下载过就直接命中本地文件，一次网络都不用
      //（Key 必须与入口无关，见 lib/page-image 的 PageImageDeps.key）
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
      const state = await loadConflictPage(fileId, page)
      shownRef.current = state.local
      setData(state)
      setSide('local')
      await drawPage()
      setStage('ready')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('scoreReader.conflict.loadFailed'))
      setStage('error')
    }
  }, [drawPage, fileId, page, presetName, presetUrl, t])

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

  /** 切预览（本地 / 远端 / 合并）：只重画批注层 */
  const switchSide = (next: Side) => {
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
  const resolve = async (choice: Side) => {
    if (!canResolve || !data) return
    setBusy(true)
    setMessage('')
    const result = await resolveAnnotationConflict({
      fileId,
      page,
      choice,
      shownVersion: data.remoteVersion,
    })
    setBusy(false)
    if (result.ok) {
      void Taro.navigateBack()
      return
    }
    if (result.reason === 'raced') {
      // 云端在我看预览的时候又变了：不拿旧选择套新内容，刷新预览让用户重看一眼。
      // ⚠️ 顺序不能颠倒：load() 一上来就 setMessage('')，先设的话这句提示一次都画不出来
      await load()
      setMessage(t('scoreReader.conflict.raced'))
      return
    }
    setMessage(t('scoreReader.conflict.failed'))
  }

  const shownStrokes = data ? strokesOf(side, data) : []

  return (
    <View className={`${darkClass} score-conflict-page flex h-full min-h-0 flex-col bg-page-bg`}>
      {chromeOn ? (
        <View className='border-b border-border px-4 py-3'>
          <Text className='block text-xs leading-relaxed text-text-muted'>
            {t('scoreReader.conflict.why')}
          </Text>
          <Text className='mt-1 block text-xs text-text-subtle'>
            {t('scoreReader.conflict.pageButton', { page })}
          </Text>
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
            {/* 加载失败给一条真出口：没有它，用户只能退出重进（而「重试」不能做成那两个
                选择按钮 —— 那正是上一条要挡的事） */}
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
          /* ⚠️ 底部留白**不能只靠 `pb-safe`**：在没有安全区的机型上它就是 0 ⇒「使用这一版」
             整个贴在页底（用户 2026-10-15 真机）。内联 px 不参与 Taro 的 px→rpx 转换，
             写多少是多少；`pt-3` 那侧照旧走工具类（与从前的 py-3 上半一致）。 */
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
        >
          {/* 切换：看的是哪一版。两个按钮是**单选的开关**（与批注栏那三支工具同款形态） */}
          <View className='mb-3 flex flex-row items-center justify-center'>
            {(['local', 'remote', 'merge'] as Side[]).map((s) => (
              <View
                key={s}
                className={`mr-2 rounded-full border px-4 py-2 ${
                  side === s ? 'border-primary bg-primary/10' : 'border-border bg-card'
                }`}
                onClick={() => switchSide(s)}
              >
                <Text className='text-xs text-text'>
                  {s === 'local'
                    ? t('scoreReader.conflict.localVersion')
                    : s === 'remote'
                      ? t('scoreReader.conflict.remoteVersion')
                      : t('scoreReader.conflict.mergeVersion')}
                </Text>
              </View>
            ))}
          </View>
          {/* 空的一版也要说清：不然用户看到「一片空白」会以为加载失败 */}
          {shownStrokes.length === 0 ? (
            <Text className='mb-3 block text-center text-xs text-text-subtle'>
              {t('scoreReader.conflict.empty')}
            </Text>
          ) : null}
          {message ? (
            <Text className='mb-3 block text-center text-xs text-danger'>{message}</Text>
          ) : null}
          {/* 单个提交按钮：作用于**当前预览的那一版**（上面那排选中的那个）。
            先看清再落库 —— 两个「用 xx 版」并成一个，不会误触直接裁决。
            预览没出来（加载中 / 失败）时**点了也不做事**（`canResolve`），置灰只是把这件事画出来
            —— 见 resolve 的注释。
            ⚠️ 「稍后处理」在这一页**已去掉**（用户 2026-10-15 定：它与导航栏返回同义）。
            入口弹层那份「稍后处理」是一等公民（那里没有别的退出方式），**别跟着一起删**
            —— 见 components/score/AnnotationConflictSheet.tsx。 */}
          <View className='flex flex-row'>
            <View
              className={`flex-1 rounded-full border border-border bg-card px-3 py-3 text-center ${
                canResolve ? '' : 'opacity-50'
              }`}
              onClick={() => void resolve(side)}
            >
              <Text className='text-sm text-text'>{t('scoreReader.conflict.useCurrent')}</Text>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  )
}
