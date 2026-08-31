import { useEffect, useMemo, useState } from 'react'
import { View, ScrollView } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useRehearsals } from '@/hooks/useRehearsals'
import { useAnnouncements } from '@/hooks/useAnnouncements'
import { useMyProfile } from '@/hooks/useMyProfile'
import { useThemeClass } from '@/context/theme-context'
import { dataSyncBump } from '@/lib/dataSync'
import { tAppError } from '@/lib/appError'
import { parseLocalISO } from '@/lib/date-utils'
import { ListState } from '@/components/ui/ListState'
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
import { AnnouncementCard } from './components/announcement-card'
import './index.scss'

export default function Index() {
  const {
    data: rehearsals,
    loading: rehearsalsLoading,
    error: rehearsalsError,
    fetch: fetchRehearsals,
  } = useRehearsals()
  const {
    data: announcements,
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

// 过滤 + 排序后的排练列表
  const rehearsalList = useMemo(() => {
    if (!rehearsals) return []
    const now = new Date(nowTick)
    // 历史日程（Issue #154）：全部已结束的合排，不限一周窗口
    if (scheduleTab === 'history') {
      return sortEndedFullRehearsals(rehearsals, now)
    }
    // 合排 tab：显示所有未来的合排（取消「未来一周」限制，但仍过滤掉已结束的）
    // 分排 tab：保持「未来一周」限制
    const filtered = rehearsals.filter((r) => {
      if (r.type !== scheduleTab) return false
      if (scheduleTab === 'full') return !isRehearsalEnded(r, now)
      return isRehearsalWithinNextWeek(r.start_time, now)
    })
    return sortRehearsalsForMember(filtered, now)
  }, [rehearsals, scheduleTab, nowTick])

  // 公告列表：根据 tab 和公告状态决定显示
  // - 合排 tab：仅显示最新的一条未过期公告（end_time > now）
  // - 历史合排 tab：显示所有已过期公告（end_time <= now），按时间倒序
  const announcementList = useMemo(() => {
    if (announcementLoading || !announcements?.length) return []
    const now = new Date(nowTick)

    const parseEndTime = (raw: string | null): Date | null => {
      if (!raw) return null
      const normalized = raw.replace(' ', 'T').split('+')[0].split('.')[0]
      return parseLocalISO(normalized)
    }

    const withExpiry = announcements.map((a) => ({
      ...a,
      endTime: parseEndTime(a.end_time),
      isExpired: !!parseEndTime(a.end_time) && parseEndTime(a.end_time)! <= now,
    }))

    if (scheduleTab === 'full') {
      // 合排 tab：找最新的一条未过期公告
      const current = withExpiry.find((a) => !a.isExpired)
      return current ? [current] : []
    }
    if (scheduleTab === 'history') {
      // 历史合排 tab：所有过期公告（已按 created_at 降序）
      return withExpiry.filter((a) => a.isExpired)
    }
    return []
  }, [announcements, announcementLoading, scheduleTab, nowTick])

  // 未查看红点：仅计算排练（不含公告）
  // 历史合排（已结束）不显示红气泡、也不计入未读（Issue #154 语义补充）
  const [seenTick, setSeenTick] = useState(0)
  useEffect(() => subscribeRehearsalSeen(() => setSeenTick((n) => n + 1)), [])
  const hasUnviewed = useMemo(
    () =>
      rehearsalList.some((r) => !isRehearsalSeen(r.id) && !isRehearsalEnded(r, new Date(nowTick))),
    // seenTick 用于强制在「标记已查看」事件后重算未查看红点
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rehearsalList, seenTick]
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
      <SegmentTabs tabs={scheduleTabs} value={scheduleTab} onChange={(k) => setScheduleTab(k)} />

      {/* 排练列表（可滚动）：统一用原生 ScrollView，与成员页/请假页一致；
        间距用 mb-3（space-y 在 WXSS 无效） */}
      <ScrollView scrollY className='flex-1 min-h-0'>
        {/* 底部留白：自定义 tabBar 固定覆盖页面底部（高 50px + 安全区），
           历史合排多时末行会被遮挡、无法滚到底，故内容底部补足留白（与成员页一致） */}
        <View className='px-4'>
          <ListState
            loading={rehearsalsLoading}
            isEmpty={announcementList.length === 0 && rehearsalList.length === 0}
            error={tAppError(t, rehearsalsError)}
            emptyText={t('home.emptySchedule')}
            onRetry={() => void fetchRehearsals()}
          >
            {announcementList.map((ann) => (
                <View key={`announcement-${ann.id}`} className='mb-3'>
                  <AnnouncementCard item={ann} isExpired={ann.isExpired} />
                </View>
              ))}
            {rehearsalList.map((r) => (
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
    </View>
  )
}
