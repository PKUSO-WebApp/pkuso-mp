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
 * 交互（用户 2026-10-14 定）：
 *   - 上方：这一页的**实时预览**，下方一个开关切「本地版 / 云端版」；
 *   - 下方：两个选择按钮 + 「稍后处理」。
 *   - **两边都不丢**：选了本地，云端那份进服务端历史（推送 RPC 覆盖时归档）；
 *     选了云端，本地这份也会**先送进历史**（`archive_sheet_music_annotation`）再覆盖本地。
 *     所以「都保留」不需要单独一个按钮 —— 它本来就是默认结果。
 *
 * ⚠️ 一切都以**预览时看到的那个云端版本**为前提：用户看预览的时候云端若又变了，
 * 这一页**什么都不做**，只提示重新看一眼。拿旧选择去套新内容，等于让用户为一个他没见过的
 * 版本做决定。
 */

const CANVAS_ID = '#conflict-canvas'
const OVERLAY_ID = '#conflict-overlay'
const BOX_ID = '#conflict-box'
const STAGE_ID = '#conflict-stage'

type Side = 'local' | 'remote'

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

  const pdfUrlRef = useRef('')
  const overlayNodeRef = useRef<CanvasNode | null>(null)
  /** 预览当前显示的那一版笔迹（切开关时只重画这一块，不重新取图） */
  const shownRef = useRef<AnnoStroke[]>([])
  const boxRef = useRef({ w: 0, h: 0 })

  const queryNode = useCallback(
    (sel: string): Promise<{ node: unknown; width: number; height: number }> =>
      new Promise((resolve, reject) => {
        Taro.createSelectorQuery()
          .select(sel)
          .fields({ node: true, size: true })
          .exec((res) => {
            const f = res?.[0]
            if (f?.node) resolve({ node: f.node, width: f.width ?? 0, height: f.height ?? 0 })
            else reject(new Error(t('scoreReader.conflict.loadFailed')))
          })
      }),
    [t]
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
    const { node: pageNode } = await queryNode(CANVAS_ID)
    const { node: overlayNode } = await queryNode(OVERLAY_ID)
    overlayNodeRef.current = overlayNode as CanvasNode

    // 舞台可用尺寸（减掉上下那两块的固定高度由 flex 布局负责，这里量的是它剩下的）
    const stageSize = await queryNode(STAGE_ID)
    const availW = stageSize.width
    const availH = stageSize.height
    if (!(availW > 0) || !(availH > 0)) throw new Error(t('scoreReader.conflict.loadFailed'))

    const img = await loadPageImage(
      pageNode as CanvasNode,
      pageImageUrls(pdfUrlRef.current, page),
      {
        // 与阅读器**同一个键**：整册预下载过就直接命中本地文件，一次网络都不用
        //（Key 必须与入口无关，见 lib/page-image 的 PageImageDeps.key）
        key: `${fileId}#${page}`,
      }
    )
    const scale = Math.min(availW / (img.width || 1), availH / (img.height || 1))
    const w = Math.max(1, Math.round((img.width || 1) * scale))
    const h = Math.max(1, Math.round((img.height || 1) * scale))
    boxRef.current = { w, h }
    setBox({ w, h })

    await waitForLayoutSize(
      async () => {
        const got = await queryNode(BOX_ID)
        return { width: got.width, height: got.height }
      },
      { width: w, height: h }
    )
    const dpr = rasterDpr(w, h)
    paintPageImage(pageNode as CanvasNode, img.img, Math.round(w * dpr), Math.round(h * dpr))
    paintOverlay(shownRef.current)
  }, [fileId, page, paintOverlay, queryNode, t])

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

  /** 切预览（本地 / 云端）：只重画批注层 */
  const switchSide = (next: Side) => {
    if (!data || next === side) return
    shownRef.current = next === 'local' ? data.local : data.remote
    setSide(next)
    paintOverlay(shownRef.current)
  }

  const resolve = async (choice: Side) => {
    if (busy || !data) return
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
      // 云端在我看预览的时候又变了：不拿旧选择套新内容，刷新预览让用户重看一眼
      setMessage(t('scoreReader.conflict.raced'))
      await load()
      return
    }
    setMessage(t('scoreReader.conflict.failed'))
  }

  const shownStrokes = data ? (side === 'local' ? data.local : data.remote) : []

  return (
    <View className={`${darkClass} score-conflict-page flex h-full min-h-0 flex-col bg-page-bg`}>
      <View className='border-b border-border px-4 py-3'>
        <Text className='block text-xs leading-relaxed text-text-muted'>
          {t('scoreReader.conflict.why')}
        </Text>
        <Text className='mt-1 block text-xs text-text-subtle'>
          {t('scoreReader.conflict.pageButton', { page })}
        </Text>
      </View>

      <View
        id='conflict-stage'
        className='relative flex flex-1 items-center justify-center overflow-hidden'
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
          </View>
        ) : null}
      </View>

      <View className='border-t border-border bg-surface px-4 py-3 pb-safe'>
        {/* 切换：看的是哪一版。两个按钮是**单选的开关**（与批注栏那三支工具同款形态） */}
        <View className='mb-3 flex flex-row items-center justify-center'>
          {(['local', 'remote'] as Side[]).map((s) => (
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
                  : t('scoreReader.conflict.remoteVersion')}
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
        <View className='flex flex-row'>
          <View
            className={`mr-2 flex-1 rounded-full border border-border bg-card px-3 py-3 text-center ${
              busy || stage !== 'ready' ? 'opacity-50' : ''
            }`}
            onClick={() => void resolve('local')}
          >
            <Text className='text-sm text-text'>{t('scoreReader.conflict.useLocal')}</Text>
          </View>
          <View
            className={`ml-2 flex-1 rounded-full border border-border bg-card px-3 py-3 text-center ${
              busy || stage !== 'ready' ? 'opacity-50' : ''
            }`}
            onClick={() => void resolve('remote')}
          >
            <Text className='text-sm text-text'>{t('scoreReader.conflict.useRemote')}</Text>
          </View>
        </View>
        <View className='mt-3 py-2 text-center' onClick={() => void Taro.navigateBack()}>
          <Text className='text-sm text-text-muted'>{t('scoreReader.conflict.later')}</Text>
        </View>
      </View>
    </View>
  )
}
