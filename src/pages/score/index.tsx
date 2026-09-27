import { useMemo, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import { useUser } from '@/context/user-context'
import { useSheetMusic, type SheetMusicWithParts } from '@/hooks/useSheetMusic'
import { SegmentTabs } from '@/components/ui/SegmentTabs'
import { ListState } from '@/components/ui/ListState'
import { translateInstrument } from '@/lib/instrument-i18n'
import './index.scss'

type TabKey = 'all' | 'mine'

export default function Score() {
  const { t } = useT()
  useNavTitle('score.navTitle')
  const darkClass = useThemeClass()
  const { user } = useUser()
  const [tab, setTab] = useState<TabKey>('all')
  const { items, myPartsBySheet, loading, error, fetch } = useSheetMusic()

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'all', label: t('score.tabs.all') },
    { key: 'mine', label: t('score.tabs.mine') },
  ]

  const visible = useMemo(
    () => (tab === 'all' ? items : items.filter((s) => myPartsBySheet[s.id])),
    [tab, items, myPartsBySheet]
  )

  // 游客模式：未登录不展示谱务文件系统（与社区页一致）
  const isGuest = !user
  if (isGuest) {
    return (
      <View
        className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg`}
        style={{ paddingBottom: 'calc(50px + env(safe-area-inset-bottom))' }}
      >
        <SegmentTabs tabs={tabs} value={tab} onChange={(k) => setTab(k)} />
        <View className='flex flex-1 items-center justify-center px-4'>
          <Text className='text-center text-sm text-text-muted'>{t('common.guestHint')}</Text>
        </View>
      </View>
    )
  }

  const openDetail = (id: string) => {
    void Taro.navigateTo({ url: `/pages/score-detail/index?id=${id}` })
  }

  /** 「分发给我的」卡片展示我被分发的声部名 */
  const mySectionLabels = (s: SheetMusicWithParts): string => {
    const ids = myPartsBySheet[s.id] ?? []
    const names = s.parts
      .filter((p) => ids.includes(p.id))
      .map((p) => translateInstrument(p.section, t))
      .filter(Boolean)
    return Array.from(new Set(names)).join('、')
  }

  const fileCount = (s: SheetMusicWithParts) => s.parts.reduce((acc, p) => acc + p.files.length, 0)

  return (
    <View
      className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg`}
      style={{ paddingBottom: 'calc(50px + env(safe-area-inset-bottom))' }}
    >
      <SegmentTabs tabs={tabs} value={tab} onChange={(k) => setTab(k)} />

      <ScrollView scrollY className='flex-1 min-h-0'>
        <View className='px-4 pb-3 pt-3'>
          <ListState
            loading={loading}
            isEmpty={visible.length === 0}
            error={error ? t('score.loadFailed', { error }) : null}
            emptyText={tab === 'all' ? t('score.emptyAll') : t('score.emptyMine')}
            onRetry={() => void fetch()}
          >
            {visible.map((s) => (
              <View
                key={s.id}
                className='mb-3 rounded-xl border border-border bg-card p-4'
                onClick={() => openDetail(s.id)}
              >
                <Text className='block text-base font-semibold text-text'>{s.title}</Text>
                {s.composer ? (
                  <Text className='mt-1 block text-sm text-text-muted'>{s.composer}</Text>
                ) : null}
                <View className='mt-2 flex flex-row items-center'>
                  <Text className='text-xs text-text-muted'>
                    {t('score.partsCount', { n: s.parts.length })}
                  </Text>
                  <Text className='ml-3 text-xs text-text-muted'>
                    {t('score.filesCount', { n: fileCount(s) })}
                  </Text>
                </View>
                {tab === 'mine' ? (
                  <View className='mt-2'>
                    <Text className='rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary'>
                      {t('score.mineBadge')}
                      {mySectionLabels(s) ? `：${mySectionLabels(s)}` : ''}
                    </Text>
                  </View>
                ) : null}
              </View>
            ))}
          </ListState>
        </View>
      </ScrollView>
    </View>
  )
}
