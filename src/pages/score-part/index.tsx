import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import { useUiScaleFactor } from '@/hooks/useUiScale'
import { tabBarReserveCss } from '@/lib/ui-scale'
import { supabase } from '@/lib/supabase'
import { useSharedScoreFiles } from '@/hooks/useSharedScoreFiles'
import { sharedFileIds } from '@/lib/shared-scores'
import { ListState } from '@/components/ui/ListState'
import { translateInstrument } from '@/lib/instrument-i18n'
import { compareFiles } from '@/lib/sheet-music-sort'
import { pinyinSortKey } from '@/lib/pinyin-sort'
import { formatFileSize } from '@/lib/format'
import { pageImageUrls } from '@/lib/score-page-image'
import type { SheetMusicFileRow, SheetMusicPartRow } from '@/types/database'
import './index.scss'

type PartWithFiles = SheetMusicPartRow & { files: SheetMusicFileRow[] }

/** `sheet_music_annotation_share_files` 视图的一行（0.6.1 共享副本） */
type ShareFileRow = {
  share_id: string
  source_file_id: string
  owner_id: string | null
  owner_name: string
  file_name: string
  storage_path: string
  file_size: number | null
  page_count: number | null
  part_id: string
  section: string
  score_id: string
  title: string
  created_at: string
  updated_at: string
}

/** 声部三级页：曲目详情点声部进入，列出该声部全部文件并直达阅读器 */
export default function ScorePart() {
  const { t } = useT()
  useNavTitle('scorePart.navTitle')
  const darkClass = useThemeClass()
  // 底边栏预留是内联 px（不吃 Tailwind token）⇒ 档位系数要自己乘
  const uiScale = useUiScaleFactor()
  const router = useRouter()
  const partId = router.params.part_id ?? ''
  const sheetTitle = router.params.sheet ? decodeURIComponent(router.params.sheet) : ''
  /** 共享入口（共享乐谱 → 曲子 → 声部）：只列共享文件，打开阅读器带 kind=shared */
  const sharedMode = router.params.shared === '1'
  const shared = useSharedScoreFiles({ enabled: sharedMode })
  const sharedIds = useMemo(() => sharedFileIds(shared.data), [shared.data])

  const [part, setPart] = useState<PartWithFiles | null>(null)
  /** 共享副本（0.6.1）：**不写 `sheet_music_files`**，在声部页合成展示 */
  const [shares, setShares] = useState<ShareFileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!partId) {
      setLoading(false)
      return
    }
    setError(null)
    try {
      const [res, shareRes] = await Promise.all([
        supabase
          .from('sheet_music_parts')
          .select('*, files:sheet_music_files(*)')
          .eq('id', partId)
          .maybeSingle(),
        // 共享副本：按声部取（视图已排除总谱）；失败不阻断普通文件展示
        (supabase as unknown as { from: (t: string) => any })
          .from('sheet_music_annotation_share_files')
          .select('*')
          .eq('part_id', partId),
      ])
      if (res.error) throw new Error(res.error.message)
      // 文件按业务契约排序（乐器拼音 / 分声部号）；查询返回顺序不保证
      const data = res.data as PartWithFiles | null
      if (data) data.files = [...(data.files ?? [])].sort(compareFiles)
      setPart(data)
      if (shareRes.error) {
        console.error('[score-part] 共享副本读取失败', shareRes.error.message)
        setShares([])
      } else {
        // 按文件名拼音序（中文 localeCompare 在真机不可靠，见 pinyin-sort）
        setShares(
          [...((shareRes.data ?? []) as ShareFileRow[])].sort((a, b) => {
            const ka = pinyinSortKey(a.file_name)
            const kb = pinyinSortKey(b.file_name)
            return ka < kb ? -1 : ka > kb ? 1 : 0
          })
        )
      }
      setLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }, [partId])

  useEffect(() => {
    void fetch()
  }, [fetch])

  // 从阅读器返回时刷新（阅读器可能改了页标题等；页图与 page_count 由 web 端在上传
  // 时写入，不经过这里 —— 这里曾写着「阅读器会回填 page_count」，那个回填写在
  // pkuso-web#378 的跨仓约定里已被删除）
  useDidShow(() => {
    void fetch()
    if (sharedMode) void shared.fetch()
  })

  /** 共享模式下只保留共享文件；总谱不参与共享 */
  const files = useMemo(() => {
    if (!part) return []
    if (!sharedMode) return part.files
    if ((part.section ?? '').trim() === '总谱') return []
    return part.files.filter((f) => sharedIds.has(f.id))
  }, [part, sharedMode, sharedIds])

  /** 预取第一页：跳转动画 + 页面初始化期间图就在下载（缓存由小程序图片层负责）。失败静默。 */
  const prefetchFirstPage = (storagePath: string, pageCount: number | null) => {
    if (!pageCount || pageCount <= 0) return
    const pdfUrl = supabase.storage.from('sheet-music').getPublicUrl(storagePath).data.publicUrl
    // 逐条试候选（当前入口优先、另一个兜底）；全失败也无所谓，真进阅读器还会再拉
    void (async () => {
      for (const url of pageImageUrls(pdfUrl, 1)) {
        try {
          await Taro.getImageInfo({ src: url })
          return
        } catch {
          // 换下一条候选
        }
      }
    })()
  }

  const openFile = (f: SheetMusicFileRow) => {
    prefetchFirstPage(f.storage_path, f.page_count)
    // 元数据随参数带给阅读器，省掉一次走反代到境外库的查询（实测 ~600ms）；
    // 缺参数时阅读器回退查库（分享链接等旧入口不受影响）
    const q = [
      sharedMode ? 'kind=shared' : '',
      `file_id=${encodeURIComponent(f.id)}`,
      `sp=${encodeURIComponent(f.storage_path)}`,
      f.page_count ? `pc=${f.page_count}` : '',
      `fn=${encodeURIComponent(f.file_name)}`,
      // 曲名与声部：阅读器**只**用它们拼「保存到…」的交付文件名
      // （`{曲子}_{声部}_{文件名}.pdf`，见 lib/pdf-save.ts）。曲名就是本页已有的
      // `sheetTitle`（面包屑在用），声部在 `part` 里。缺了不影响功能——回退成
      // `{文件名}.pdf`。
      // 文件字节数：阅读器只用它做**分片下载**的终止条件与长度校验（见 lib/ranged-download.ts）
      f.file_size ? `sz=${f.file_size}` : '',
      sheetTitle ? `title=${encodeURIComponent(sheetTitle)}` : '',
      part?.section ? `sec=${encodeURIComponent(part.section)}` : '',
    ]
      .filter(Boolean)
      .join('&')
    void Taro.navigateTo({ url: `/pages/score-reader/index?${q}` })
  }

  /**
   * 打开共享副本（0.6.1）：阅读器用 `kind=share` 区分；
   * `file_id` 仍是**源文件**（页图/PDF/缓存都按它），批注层按 `share_id` 取。
   */
  const openShare = (s: ShareFileRow) => {
    prefetchFirstPage(s.storage_path, s.page_count)
    const q = [
      'kind=share',
      `share_id=${encodeURIComponent(s.share_id)}`,
      `file_id=${encodeURIComponent(s.source_file_id)}`,
      `sp=${encodeURIComponent(s.storage_path)}`,
      s.page_count ? `pc=${s.page_count}` : '',
      `fn=${encodeURIComponent(s.file_name)}`,
      s.file_size ? `sz=${s.file_size}` : '',
      sheetTitle ? `title=${encodeURIComponent(sheetTitle)}` : '',
      part?.section ? `sec=${encodeURIComponent(part.section)}` : '',
    ]
      .filter(Boolean)
      .join('&')
    void Taro.navigateTo({ url: `/pages/score-reader/index?${q}` })
  }

  const sectionLabel = part ? translateInstrument(part.section, t) : ''

  return (
    <View
      className={`${darkClass} relative flex h-full min-h-0 flex-col bg-page-bg`}
      style={{ paddingBottom: tabBarReserveCss(uiScale) }}
    >
      {/* 面包屑：曲名 / 声部名（曲名点击返回曲目详情） */}
      <View className='flex flex-row items-center px-4 pt-3 text-sm'>
        <Text className='text-primary' onClick={() => void Taro.navigateBack()}>
          {sheetTitle || t('scoreDetail.rootCrumb')}
        </Text>
        <Text className='mx-1.5 text-text-muted'>/</Text>
        <Text className='flex-1 text-text-muted' numberOfLines={1}>
          {sectionLabel}
        </Text>
      </View>

      <ScrollView scrollY className='flex-1 min-h-0'>
        <View className='px-4 pb-4 pt-3'>
          <ListState
            loading={loading || (sharedMode && shared.loading)}
            isEmpty={!loading && !part}
            error={error ? t('scoreDetail.loadFailed', { error }) : null}
            emptyText={t('scorePart.notFound')}
            onRetry={() => {
              void fetch()
              if (sharedMode) void shared.fetch()
            }}
          >
            {part ? (
              <View className='overflow-hidden rounded-xl border border-border bg-card'>
                {files.length === 0 && shares.length === 0 ? (
                  <Text className='block px-4 py-4 text-xs text-text-muted'>
                    {t(sharedMode ? 'score.emptyShared' : 'scoreDetail.emptyFiles')}
                  </Text>
                ) : (
                  <View className='px-4 pb-2 pt-2'>
                    {files.map((f, i) => {
                      const sizeText = formatFileSize(f.file_size)
                      const pagesText =
                        f.page_count != null ? t('scoreDetail.pages', { n: f.page_count }) : ''
                      const meta = [sizeText, pagesText].filter(Boolean).join(' · ')
                      return (
                        // 打开与「保存到…」两枚按钮都去掉了，改成与**声部行**同款的右箭头
                        // （用户 2026-10-10 定）：整行可点即进阅读器，右侧一个 › 示意。
                        // 这也顺带取消了文件级的「保存到…」入口 —— 要存 PDF 进阅读器再点转发。
                        <View
                          key={f.id}
                          className={`flex flex-row items-center justify-between py-3${
                            i === 0 ? '' : ' border-t border-border'
                          }`}
                          onClick={() => openFile(f)}
                        >
                          <View className='flex-1 pr-3'>
                            <Text className='block text-sm text-text'>{f.file_name}</Text>
                            <Text className='mt-0.5 block text-xs text-text-muted'>
                              {meta || t('scoreDetail.unknownSize')}
                            </Text>
                          </View>
                          <Text className='text-lg text-text-muted'>›</Text>
                        </View>
                      )
                    })}
                    {shares.map((s, i) => {
                      const sizeText = formatFileSize(s.file_size)
                      const pagesText =
                        s.page_count != null ? t('scoreDetail.pages', { n: s.page_count }) : ''
                      const meta = [sizeText, pagesText].filter(Boolean).join(' · ')
                      return (
                        // 共享副本（0.6.1）：与普通文件同形；文件名已带「-批注by人名.pdf」。
                        // 不计入文件数/打印份数，但在这张声部文件列表里是**可见、可打开**的。
                        <View
                          key={`share-${s.share_id}`}
                          className={`flex flex-row items-center justify-between py-3${
                            files.length + i === 0 ? '' : ' border-t border-border'
                          }`}
                          onClick={() => openShare(s)}
                        >
                          <View className='flex-1 pr-3'>
                            <Text className='block text-sm text-text'>{s.file_name}</Text>
                            <Text className='mt-0.5 block text-xs text-text-muted'>
                              {meta || t('scoreDetail.unknownSize')}
                            </Text>
                          </View>
                          <Text className='text-lg text-text-muted'>›</Text>
                        </View>
                      )
                    })}
                  </View>
                )}
              </View>
            ) : null}
          </ListState>
        </View>
      </ScrollView>
    </View>
  )
}
