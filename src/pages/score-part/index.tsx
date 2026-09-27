import { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import { supabase } from '@/lib/supabase'
import { ListState } from '@/components/ui/ListState'
import { translateInstrument } from '@/lib/instrument-i18n'
import { compareFiles } from '@/lib/sheet-music-sort'
import { formatFileSize } from '@/lib/format'
import type { SheetMusicFileRow, SheetMusicPartRow } from '@/types/database'
import './index.scss'

type PartWithFiles = SheetMusicPartRow & { files: SheetMusicFileRow[] }

/** 声部三级页：曲目详情点声部进入，列出该声部全部文件并直达阅读器 */
export default function ScorePart() {
  const { t } = useT()
  useNavTitle('scorePart.navTitle')
  const darkClass = useThemeClass()
  const router = useRouter()
  const partId = router.params.part_id ?? ''
  const sheetTitle = router.params.sheet ? decodeURIComponent(router.params.sheet) : ''

  const [part, setPart] = useState<PartWithFiles | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!partId) {
      setLoading(false)
      return
    }
    setError(null)
    try {
      const res = await supabase
        .from('sheet_music_parts')
        .select('*, files:sheet_music_files(*)')
        .eq('id', partId)
        .maybeSingle()
      if (res.error) throw new Error(res.error.message)
      // 文件按业务契约排序（乐器拼音 / 分声部号）；查询返回顺序不保证
      const data = res.data as PartWithFiles | null
      if (data) data.files = [...(data.files ?? [])].sort(compareFiles)
      setPart(data)
      setLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }, [partId])

  useEffect(() => {
    void fetch()
  }, [fetch])

  // 从阅读器返回时刷新（阅读器会回填 page_count）
  useDidShow(() => {
    void fetch()
  })

  const openFile = (f: SheetMusicFileRow) => {
    void Taro.navigateTo({
      url: `/pages/score-reader/index?file_id=${encodeURIComponent(f.id)}`,
    })
  }

  const sectionLabel = part ? translateInstrument(part.section, t) : ''

  return (
    <View
      className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg`}
      style={{ paddingBottom: 'calc(50px + env(safe-area-inset-bottom))' }}
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
            loading={loading}
            isEmpty={!loading && !part}
            error={error ? t('scoreDetail.loadFailed', { error }) : null}
            emptyText={t('scorePart.notFound')}
            onRetry={() => void fetch()}
          >
            {part ? (
              <View className='overflow-hidden rounded-xl border border-border bg-card'>
                {part.files.length === 0 ? (
                  <Text className='block px-4 py-4 text-xs text-text-muted'>
                    {t('scoreDetail.emptyFiles')}
                  </Text>
                ) : (
                  <View className='px-4 pb-2 pt-2'>
                    {part.files.map((f, i) => {
                      const sizeText = formatFileSize(f.file_size)
                      const pagesText =
                        f.page_count != null ? t('scoreDetail.pages', { n: f.page_count }) : ''
                      const meta = [sizeText, pagesText].filter(Boolean).join(' · ')
                      return (
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
                          <Text className='text-xs font-medium text-primary'>
                            {t('scoreDetail.open')}
                          </Text>
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
