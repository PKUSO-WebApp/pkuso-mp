import { useMemo, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import { useUser } from '@/context/user-context'
import { useMyProfile } from '@/hooks/useMyProfile'
import { useSheetMusic, type SheetMusicWithParts } from '@/hooks/useSheetMusic'
import { SegmentTabs } from '@/components/ui/SegmentTabs'
import { ListState } from '@/components/ui/ListState'
import { StaffBlockedPage } from '@/components/staff-blocked-page'
import { translateInstrument } from '@/lib/instrument-i18n'
import { myPartOf } from '@/lib/sheet-music-mine'
import { isOrchestraMember } from '@/lib/role-gate'
import './index.scss'

type TabKey = 'all' | 'mine'

export default function Score() {
  const { t } = useT()
  useNavTitle('score.navTitle')
  const darkClass = useThemeClass()
  const { user } = useUser()
  const { profile: myProfile, loading: myProfileLoading } = useMyProfile()
  const [tab, setTab] = useState<TabKey>('all')
  const { items, loading, error, fetch } = useSheetMusic()

  /**
   * 「分发给我的」= **含我声部的乐谱**（2026-10-11 用户定的现阶段口径：暂时不看
   * `sheet_music_distributions`）。我的声部取自 profile，与 `sheet_music_parts.section`
   * 是同一套闭集词表，判据见 `lib/sheet-music-mine.ts`。
   */
  const mySection = (myProfile?.instrument ?? '').trim()
  const mySectionLabel = translateInstrument(mySection, t)

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'all', label: t('score.tabs.all') },
    { key: 'mine', label: t('score.tabs.mine') },
  ]

  const visible = useMemo(
    () => (tab === 'all' ? items : items.filter((s) => myPartOf(s.parts, mySection))),
    [tab, items, mySection]
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

  // 非团员账号（admin / score_manager 等专职账号）一律阻断：谱务是给**成员**用的文件阅览器，
  // 专职账号在网页端办公。判据与其余 tab 页同一条（isOrchestraMember），别改回黑名单式。
  // ⚠️ 必须排在游客分支**之后**：useMyProfile 在无 user 时会误查全表，拿到的可能是别人的行。
  if (!isOrchestraMember(myProfile?.role)) {
    return <StaffBlockedPage role={myProfile?.role} />
  }

  const openDetail = (id: string) => {
    void Taro.navigateTo({ url: `/pages/score-detail/index?id=${id}` })
  }

  /**
   * 「分发给我的」的层级是**曲子/谱子**——**跳过声部那一层**（用户 2026-10-11 定）：
   * 直接进「我那个声部」的文件列表。复用现成的声部页（它本来就是「一个声部 → 它的文件
   * → 阅读器」），所以这里只需要把 part_id 换成**我的**那一个。
   */
  const openMyFiles = (s: SheetMusicWithParts) => {
    const mine = myPartOf(s.parts, mySection)
    if (!mine) return
    const sheet = encodeURIComponent(s.title ?? '')
    void Taro.navigateTo({
      url: `/pages/score-part/index?part_id=${encodeURIComponent(mine.id)}&sheet=${sheet}`,
    })
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
            // 「分发给我的」还得等 profile（我的声部就在里面）：没到手之前**不能**把
            // 「还不知道」显示成「你的声部暂无乐谱」——那是句陈述。ListState 只在
            // 「loading && 内容为空」时显示加载中，所以这里把它一并抬起来即可。
            loading={loading || (tab === 'mine' && myProfileLoading)}
            isEmpty={visible.length === 0}
            error={error ? t('score.loadFailed', { error }) : null}
            emptyText={tab === 'all' ? t('score.emptyAll') : t('score.emptyMine')}
            onRetry={() => void fetch()}
          >
            {visible.map((s) => {
              const mine = tab === 'mine' ? myPartOf(s.parts, mySection) : null
              return (
                <View
                  key={s.id}
                  className='mb-3 rounded-xl border border-border bg-card p-4'
                  onClick={() => (tab === 'mine' ? openMyFiles(s) : openDetail(s.id))}
                >
                  <Text className='block text-base font-semibold text-text'>{s.title}</Text>
                  {s.composer ? (
                    <Text className='mt-1 block text-sm text-text-muted'>{s.composer}</Text>
                  ) : null}
                  {tab === 'mine' ? (
                    // 这一栏列的是**我的**谱子，所以数量按我那份算：「整曲有多少声部 / 多少文件」
                    // 在这里没有意义（谁在这栏里看到的都是同一份曲子）。
                    <View className='mt-2 flex flex-row items-center'>
                      <Text className='text-xs text-text-muted'>
                        {t('score.filesCount', { n: mine?.files.length ?? 0 })}
                      </Text>
                      <Text className='ml-3 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary'>
                        {t('score.mineBadge')}
                        {mySectionLabel ? `：${mySectionLabel}` : ''}
                      </Text>
                    </View>
                  ) : (
                    <View className='mt-2 flex flex-row items-center'>
                      <Text className='text-xs text-text-muted'>
                        {t('score.partsCount', { n: s.parts.length })}
                      </Text>
                      <Text className='ml-3 text-xs text-text-muted'>
                        {t('score.filesCount', { n: fileCount(s) })}
                      </Text>
                    </View>
                  )}
                </View>
              )
            })}
          </ListState>
        </View>
      </ScrollView>
    </View>
  )
}
