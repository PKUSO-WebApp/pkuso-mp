import { View, Text, ScrollView } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import { useSheetMusicDetail, type SheetMusicPartWithFiles } from '@/hooks/useSheetMusic'
import { ListState } from '@/components/ui/ListState'
import { translateInstrument } from '@/lib/instrument-i18n'
import './index.scss'

export default function ScoreDetail() {
  const { t } = useT()
  useNavTitle('scoreDetail.navTitle')
  const darkClass = useThemeClass()
  const router = useRouter()
  const id = router.params.id ?? ''
  const { item, loading, error, fetch } = useSheetMusicDetail(id)

  // 声部行 → 三级页（该声部的全部文件在 pages/score-part 内展示）
  const openPart = (p: SheetMusicPartWithFiles) => {
    const sheet = encodeURIComponent(item?.title ?? '')
    void Taro.navigateTo({
      url: `/pages/score-part/index?part_id=${encodeURIComponent(p.id)}&sheet=${sheet}`,
    })
  }

  return (
    <View
      className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg`}
      style={{ paddingBottom: 'calc(50px + env(safe-area-inset-bottom))' }}
    >
      {/* 面包屑：谱务 / 曲名 */}
      <View className='mb-1 flex flex-row items-center px-4 pt-3 text-sm'>
        <Text className='text-primary' onClick={() => void Taro.navigateBack()}>
          {t('scoreDetail.rootCrumb')}
        </Text>
        <Text className='mx-1.5 text-text-muted'>/</Text>
        <Text className='flex-1 text-text-muted' numberOfLines={1}>
          {item?.title ?? ''}
        </Text>
      </View>

      <ScrollView scrollY className='flex-1 min-h-0'>
        <View className='px-4 pb-4'>
          <ListState
            loading={loading}
            isEmpty={!loading && !item}
            error={error ? t('scoreDetail.loadFailed', { error }) : null}
            emptyText={t('scoreDetail.notFound')}
            onRetry={() => void fetch()}
          >
            {item ? (
              <View>
                {item.parts.length === 0 ? (
                  <Text className='block py-8 text-center text-sm text-text-muted'>
                    {t('scoreDetail.emptyParts')}
                  </Text>
                ) : (
                  item.parts.map((p) => {
                    const sectionLabel = translateInstrument(p.section ?? p.instrument, t)
                    return (
                      <View
                        key={p.id}
                        className='mb-3 overflow-hidden rounded-xl border border-border bg-card'
                      >
                        <View
                          className='flex flex-row items-center justify-between p-4'
                          onClick={() => openPart(p)}
                        >
                          <View className='flex-1 pr-3'>
                            <Text className='block text-sm font-medium text-text'>
                              {sectionLabel || '—'}
                            </Text>
                          </View>
                          <Text className='text-lg text-text-muted'>›</Text>
                        </View>
                      </View>
                    )
                  })
                )}
              </View>
            ) : null}
          </ListState>
        </View>
      </ScrollView>
    </View>
  )
}
