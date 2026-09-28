import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useShareAppMessage } from '@tarojs/taro'
import { useRehearsals } from '@/hooks/useRehearsals'
import { useAnnouncements } from '@/hooks/useAnnouncements'
import { useMyProfile } from '@/hooks/useMyProfile'
import { useUser } from '@/context/user-context'
import { useThemeClass } from '@/context/theme-context'
import { dataSyncBump } from '@/lib/dataSync'
import { tAppError } from '@/lib/appError'
import { parseLocalISO, getLocalDateString } from '@/lib/date-utils'
import { ListState } from '@/components/ui/ListState'
import { AdminBlockedPage } from '@/components/admin-blocked-page'
import { SegmentTabs } from '@/components/ui/SegmentTabs'

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
    // 曾经这里没解构 error：公告加载失败时列表被清空（useAnnouncements 失败分支
    // 会 setData([])）而界面没有任何提示——用户看到的是「暂无日程」，
    // 与「真的没有日程」分不出来。见下面 ListState 的 error 合并。
    error: announcementError,
    fetch: fetchAnnouncement,
  } = useAnnouncements()
  const { profile: myProfile } = useMyProfile()
  const { user } = useUser()
  const darkClass = useThemeClass()
  const { t } = useT()
  useNavTitle('home.navTitle')

  // 游客模式：未登录时显示空态提示
  const isGuest = !user

  // 冷启动时 useRehearsals / useAnnouncements 的挂载 effect 已经在**同一 tick** 拉过一轮，
  // 紧接着的首次 useDidShow 拉的是同一个端点、同一个会话——是纯重复。
  // 实测一次冷启动发 7 个跨境请求，其中 3 个是这种重复，删掉能把 7 降到 4，
  // 而且**不牺牲首屏速度**（删的是冗余，不是把并发改慢）。写法同 community 页。
  const firstShowRef = useRef(true)

  // 每次切回首页重新拉取排练与公告，并重置全局轮询计时器。
  // 静默重取：已有数据时不翻 loading，避免切 tab 整页闪烁
  useDidShow(() => {
    // ⚠️ 只跳这两个 fetch。下面还管着转发菜单（游客/登录两分支），跳过整个回调会让
    // 菜单状态出错；dataSyncBump 也不能跳（它只重置本地计时器，不发请求）。
    if (firstShowRef.current) {
      firstShowRef.current = false
    } else {
      void fetchRehearsals({ silent: true })
      void fetchAnnouncement({ silent: true })
    }
    dataSyncBump()

    // 根据登录状态控制右上角转发菜单
    if (isGuest) {
      wx.hideShareMenu()
    } else {
      wx.showShareMenu({ menus: ['shareAppMessage'] })
    }
  })

  // 下拉刷新：静默重取排练与公告
  usePullDownRefresh(() => {
    void fetchRehearsals({ silent: true })
    void fetchAnnouncement({ silent: true })
    Taro.stopPullDownRefresh()
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
    // 分排 tab：保持「未来一周」限制，且仅显示用户声部匹配的分排
    const filtered = rehearsals.filter((r) => {
      if (r.type !== scheduleTab) return false
      if (scheduleTab === 'full') return !isRehearsalEnded(r, now)
      // 分排：仅显示目标声部包含用户声部的排练
      if (!myProfile?.instrument) return false
      // 兼容旧数据：target_section 可能是字符串（旧格式）或数组（新格式）
      const rawTargets = r.target_section
      const targets = Array.isArray(rawTargets) ? rawTargets : rawTargets ? [rawTargets] : []
      if (targets.length === 0) return false // 空 = 仅管理员可见
      return targets.includes(myProfile.instrument)
    })
    return sortRehearsalsForMember(filtered, now)
  }, [rehearsals, scheduleTab, nowTick, myProfile?.instrument])

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

  // 分享：基于当前 tab 的排练日期范围生成标题
  const shareTitle = useMemo(() => {
    if (rehearsalList.length === 0) {
      const today = getLocalDateString()
      const todayDate = new Date(today + 'T00:00:00')
      const endDate = new Date(todayDate)
      endDate.setDate(todayDate.getDate() + 7)
      const startStr = `${todayDate.getMonth() + 1}.${todayDate.getDate()}`
      const endStr = `${endDate.getMonth() + 1}.${endDate.getDate()}`
      if (scheduleTab === 'full')
        return t('schedule.share.fullTitle', { start: startStr, end: endStr })
      if (scheduleTab === 'section')
        return t('schedule.share.sectionTitle', { start: startStr, end: endStr })
      return t('schedule.share.historyTitle', { start: startStr, end: endStr })
    }
    const times = rehearsalList
      .map((r) => {
        if (!r.start_time) return null
        const start = parseLocalISO(r.start_time)
        if (start.getFullYear() < 2000) return null
        let endMs = start.getTime() + 3 * 60 * 60 * 1000
        if (r.end_time) {
          const end = parseLocalISO(r.end_time)
          if (end.getFullYear() >= 2000) endMs = end.getTime()
        }
        return { startMs: start.getTime(), endMs }
      })
      .filter((item): item is { startMs: number; endMs: number } => item !== null)
    if (times.length === 0) {
      const today = getLocalDateString()
      const todayDate = new Date(today + 'T00:00:00')
      const endDate = new Date(todayDate)
      endDate.setDate(todayDate.getDate() + 7)
      const startStr = `${todayDate.getMonth() + 1}.${todayDate.getDate()}`
      const endStr = `${endDate.getMonth() + 1}.${endDate.getDate()}`
      if (scheduleTab === 'full')
        return t('schedule.share.fullTitle', { start: startStr, end: endStr })
      if (scheduleTab === 'section')
        return t('schedule.share.sectionTitle', { start: startStr, end: endStr })
      return t('schedule.share.historyTitle', { start: startStr, end: endStr })
    }
    const minStart = Math.min(...times.map((item) => item.startMs))
    const maxEnd = Math.max(...times.map((item) => item.endMs))
    const startDate = new Date(minStart)
    const endDate = new Date(maxEnd)
    const startStr = `${startDate.getMonth() + 1}.${startDate.getDate()}`
    const endStr = `${endDate.getMonth() + 1}.${endDate.getDate()}`
    if (scheduleTab === 'full')
      return t('schedule.share.fullTitle', { start: startStr, end: endStr })
    if (scheduleTab === 'section')
      return t('schedule.share.sectionTitle', { start: startStr, end: endStr })
    return t('schedule.share.historyTitle', { start: startStr, end: endStr })
  }, [rehearsalList, scheduleTab, t])

  // 分享回调（未登录时不分享）
  useShareAppMessage(() => {
    if (isGuest) return { title: '' }
    return { title: shareTitle }
  })

  // 游客模式：未登录时显示空态提示（必须在 admin 检查之前，避免 useMyProfile 在无 user 时误查全表）
  if (isGuest) {
    return (
      <View
        className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg`}
        style={{ paddingBottom: 'calc(50px + env(safe-area-inset-bottom))' }}
      >
        <View className='mb-3'>
          <SegmentTabs
            tabs={scheduleTabs}
            value={scheduleTab}
            onChange={(k) => setScheduleTab(k)}
          />
        </View>
        <View className='flex flex-1 items-center justify-center px-4'>
          <Text className='text-center text-sm text-text-muted'>{t('common.guestHint')}</Text>
        </View>
      </View>
    )
  }

  // 管理端登录：不提供小程序管理端，显示阻断页（规划 §1：admin 留在 Web）
  if (myProfile?.role === 'admin') {
    return <AdminBlockedPage />
  }

  return (
    <View
      className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg`}
      style={{ paddingBottom: 'calc(50px + env(safe-area-inset-bottom))' }}
    >
      <View className='mb-3'>
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
            isEmpty={announcementList.length === 0 && rehearsalList.length === 0}
            // 两个来源的错误都算「这一屏加载失败」：公告那半以前没接 error，而它失败时
            // useAnnouncements 会把列表清空——于是用户看到的是「暂无日程」，
            // 与「真的没有日程」分不出来。两者的错误码都归一成同一条 loadFailed 文案，
            // 所以取第一个非空的即可，不需要拼两句话。
            error={tAppError(t, rehearsalsError) ?? tAppError(t, announcementError)}
            emptyText={t('home.emptySchedule')}
            // 重试要**两个都重试**：以前只重试排练，公告失败时点「重试」仍然看不到公告
            onRetry={() => {
              void fetchRehearsals()
              void fetchAnnouncement()
            }}
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
