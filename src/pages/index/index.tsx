import { useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useRehearsals } from '@/hooks/useRehearsals'
import { useAnnouncements } from '@/hooks/useAnnouncements'
import { useMyProfile } from '@/hooks/useMyProfile'
import { useThemeClass } from '@/context/theme-context'
import { dataSyncBump } from '@/lib/dataSync'
import { tAppError } from '@/lib/appError'
import { formatDateTimeInChina } from '@/lib/date-utils'
import { ListState } from '@/components/ui/ListState'
import { Modal } from '@/components/ui/Modal'
import { AdminBlockedPage } from '@/components/admin-blocked-page'
import { SegmentTabs } from '@/components/ui/SegmentTabs'

import { isRehearsalWithinNextWeek } from '@/lib/rehearsal-utils'
import {
  isRehearsalUpdated,
  isRehearsalEnded,
  sortRehearsalsForMember,
  sortEndedFullRehearsals,
} from '@/lib/rehearsal-sort'
import {
  isRehearsalSeen,
  subscribeRehearsalSeen,
  setRehearsalUnviewedFlag,
} from '@/lib/rehearsalSeen'
import { useT, useNavTitle } from '@/i18n'
import { RehearsalCard } from './components/rehearsal-card'
import './index.scss'

export default function Index() {
  const {
    data: rehearsals,
    loading: rehearsalsLoading,
    error: rehearsalsError,
    fetch: fetchRehearsals,
  } = useRehearsals()
  const {
    data: announcement,
    loading: announcementLoading,
    fetch: fetchAnnouncement,
  } = useAnnouncements()
  const { profile: myProfile } = useMyProfile()
  const darkClass = useThemeClass()
  const { t } = useT()
  useNavTitle('home.navTitle')

  // 每次切回首页重新拉取排练与公告，并重置全局轮询计时器。
  // 静默重取：已有数据时不翻 loading，避免切 tab 整页闪烁
  useDidShow(() => {
    void fetchRehearsals({ silent: true })
    void fetchAnnouncement({ silent: true })
    dataSyncBump()
  })

  const [scheduleTab, setScheduleTab] = useState<'full' | 'section' | 'history'>('full')
  const scheduleTabs: { key: 'full' | 'section' | 'history'; label: string }[] = [
    { key: 'full', label: t('home.tabs.full') },
    { key: 'section', label: t('home.tabs.section') },
    { key: 'history', label: t('home.tabs.history') },
  ]
  const [nowTick, setNowTick] = useState(() => Date.now())

  // 每分钟更新 nowTick，驱动列表过滤
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 60 * 1000)
    return () => clearInterval(timer)
  }, [])

  // 公告详情弹窗（成员主页顶部公告条点击打开）
  const [showAnnouncementDetail, setShowAnnouncementDetail] = useState(false)

  // 过滤 + 排序后的排练列表
  const list = useMemo(() => {
    if (!rehearsals) return []
    const now = new Date(nowTick)
    // 历史合排（Issue #154）：全部已结束的合排，不限一周窗口
    if (scheduleTab === 'history') {
      return sortEndedFullRehearsals(rehearsals, now)
    }
    const filtered = rehearsals.filter(
      (r) => r.type === scheduleTab && isRehearsalWithinNextWeek(r.start_time, now)
    )
    return sortRehearsalsForMember(filtered, now)
  }, [rehearsals, scheduleTab, nowTick])

  // 未查看红点：列表中存在尚未打开详情页且**尚未结束**的排练时点亮首页 tabBar 红点。
  // 历史合排（已结束）不显示红气泡、也不计入未读（Issue #154 语义补充）
  const [seenTick, setSeenTick] = useState(0)
  useEffect(() => subscribeRehearsalSeen(() => setSeenTick((n) => n + 1)), [])
  const hasUnviewed = useMemo(
    () => list.some((r) => !isRehearsalSeen(r.id) && !isRehearsalEnded(r, new Date(nowTick))),
    // seenTick 用于强制在「标记已查看」事件后重算未查看红点
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, seenTick]
  )
  useEffect(() => {
    setRehearsalUnviewedFlag(hasUnviewed)
  }, [hasUnviewed])

  // 管理端登录：不提供小程序管理端，显示阻断页（规划 §1：admin 留在 Web）
  if (myProfile?.role === 'admin') {
    return <AdminBlockedPage />
  }

  return (
    <View
      className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg`}
      style={{ paddingBottom: 'calc(50px + env(safe-area-inset-bottom))' }}
    >
      {/* 公告条置于 header 之上（用户要求置顶）：点击展开详情；
         冷启动公告到达时会顶推下方 header/切换器，此为相对原滚动内置方案的取舍 */}
      {!announcementLoading && announcement?.content ? (
        <View className='mb-3 mt-4 px-4' onClick={() => setShowAnnouncementDetail(true)}>
          <View className='flex items-center gap-2 rounded-xl border border-warning bg-warning-bg px-3 py-2'>
            <Text className='shrink-0 text-warning'>📢</Text>
            <View className='min-w-0 flex-1 max-h-[60px] overflow-hidden'>
              <Text className='text-xs leading-relaxed text-warning'>{announcement.content}</Text>
            </View>
          </View>
        </View>
      ) : null}

      <View className='mb-3 mt-1 px-4'>
        <SegmentTabs tabs={scheduleTabs} value={scheduleTab} onChange={(k) => setScheduleTab(k)} />
      </View>

      {/* 排练列表（可滚动）：统一用原生 ScrollView，与成员页/请假页一致；
        间距用 mb-3（space-y 在 WXSS 无效） */}
      <ScrollView scrollY className='flex-1 min-h-0'>
        {/* 底部留白：自定义 tabBar 固定覆盖页面底部（高 50px + 安全区），
           历史合排多时末行会被遮挡、无法滚到底，故内容底部补足留白（与成员页一致） */}
        <View className='px-4'>
          <ListState
            loading={rehearsalsLoading}
            isEmpty={list.length === 0}
            error={tAppError(t, rehearsalsError)}
            emptyText={t('home.emptySchedule')}
            onRetry={() => void fetchRehearsals()}
          >
            {list.map((r) => (
              <View key={String(r.id)} className='mb-3'>
                <RehearsalCard
                  item={r}
                  isUpdated={isRehearsalUpdated(r) && !isRehearsalEnded(r, new Date(nowTick))}
                  onClick={() =>
                    Taro.navigateTo({ url: `/pages/rehearsal-detail/index?id=${r.id}` })
                  }
                  // 已结束（历史合排）不显示红气泡
                  seen={isRehearsalSeen(r.id) || isRehearsalEnded(r, new Date(nowTick))}
                />
              </View>
            ))}
          </ListState>
        </View>
      </ScrollView>

      {/* 公告详情弹窗（顶部公告条点击打开，只读） */}
      <Modal
        open={showAnnouncementDetail}
        onClose={() => setShowAnnouncementDetail(false)}
        title={t('home.announcementDetail')}
        position='bottom'
      >
        <View>
          <Text className='mb-3 block text-xs text-text-muted'>
            {t('home.publishTime', {
              time: formatDateTimeInChina(announcement?.created_at ?? null),
            })}
          </Text>
          <Text className='whitespace-pre-wrap break-words text-sm leading-relaxed text-text'>
            {announcement?.content}
          </Text>
        </View>
      </Modal>
    </View>
  )
}
