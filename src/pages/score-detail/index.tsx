import { useMemo } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import { useUiScaleFactor } from '@/hooks/useUiScale'
import { tabBarReserveCss } from '@/lib/ui-scale'
import { useSheetMusicDetail, type SheetMusicPartWithFiles } from '@/hooks/useSheetMusic'
import { useSharedScoreFiles } from '@/hooks/useSharedScoreFiles'
import { sharedFileIds } from '@/lib/shared-scores'
import { ListState } from '@/components/ui/ListState'
import { translateInstrument } from '@/lib/instrument-i18n'
import './index.scss'

export default function ScoreDetail() {
  const { t } = useT()
  useNavTitle('scoreDetail.navTitle')
  const darkClass = useThemeClass()
  // 底边栏预留是内联 px（不吃 Tailwind token）⇒ 档位系数要自己乘
  const uiScale = useUiScaleFactor()
  const router = useRouter()
  const id = router.params.id ?? ''
  /** 共享入口（从「共享的乐谱」进来）：只列有共享谱的声部，总谱不参与共享 */
  const sharedMode = router.params.shared === '1'
  const { item, loading, error, fetch } = useSheetMusicDetail(id)
  const shared = useSharedScoreFiles({ enabled: sharedMode })
  const sharedIds = useMemo(() => sharedFileIds(shared.data), [shared.data])

  // 从共享阅读器返回时刷新共享文件集合：那边改批注会更新 `updated_at`
  useDidShow(() => {
    if (sharedMode) void shared.fetch()
  })

  /**
   * 共享模式下把声部收窄到「确有共享谱」的那些，并把每个声部里的文件也过滤成
   * 共享文件 —— 普通入口（`shared=0`）完全走原路径。
   */
  const parts = useMemo(() => {
    if (!item) return []
    if (!sharedMode) return item.parts
    return item.parts
      .filter((p) => (p.section ?? '').trim() !== '总谱')
      .map((p) => ({ ...p, files: p.files.filter((f) => sharedIds.has(f.id)) }))
      .filter((p) => p.files.length > 0)
  }, [item, sharedMode, sharedIds])

  // 声部行 → 三级页（该声部的文件在 pages/score-part 内展示；共享入口继续带 shared=1）
  const openPart = (p: SheetMusicPartWithFiles) => {
    const sheet = encodeURIComponent(item?.title ?? '')
    void Taro.navigateTo({
      url: `/pages/score-part/index?part_id=${encodeURIComponent(p.id)}&sheet=${sheet}${
        sharedMode ? '&shared=1' : ''
      }`,
    })
  }

  return (
    <View
      className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg`}
      style={{ paddingBottom: tabBarReserveCss(uiScale) }}
    >
      {/* 面包屑：谱务（共享入口则是「共享的乐谱」）/ 曲名 */}
      <View className='mb-1 flex flex-row items-center px-4 pt-3 text-sm'>
        <Text className='text-primary' onClick={() => void Taro.navigateBack()}>
          {t(sharedMode ? 'score.tabs.shared' : 'scoreDetail.rootCrumb')}
        </Text>
        <Text className='mx-1.5 text-text-muted'>/</Text>
        <Text className='flex-1 text-text-muted' numberOfLines={1}>
          {item?.title ?? ''}
        </Text>
      </View>

      <ScrollView scrollY className='flex-1 min-h-0'>
        <View className='px-4 pb-4'>
          <ListState
            loading={loading || (sharedMode && shared.loading)}
            isEmpty={!loading && !item}
            error={error ? t('scoreDetail.loadFailed', { error }) : null}
            emptyText={t('scoreDetail.notFound')}
            onRetry={() => {
              void fetch()
              if (sharedMode) void shared.fetch()
            }}
          >
            {item ? (
              <View>
                {parts.length === 0 ? (
                  <Text className='block py-8 text-center text-sm text-text-muted'>
                    {t(sharedMode ? 'score.emptyShared' : 'scoreDetail.emptyParts')}
                  </Text>
                ) : (
                  parts.map((p) => {
                    const sectionLabel = translateInstrument(p.section, t)
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
                          {sharedMode ? (
                            <Text className='mr-2 text-xs text-text-muted'>
                              {t('score.filesCount', { n: p.files.length })}
                            </Text>
                          ) : null}
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
