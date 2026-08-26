import { useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useRehearsals } from '@/hooks/useRehearsals'
import { useAnnouncements } from '@/hooks/useAnnouncements'
import { useMyProfile } from '@/hooks/useMyProfile'
import { useUser } from '@/context/user-context'
import { useThemeClass } from '@/context/theme-context'
import { dataSyncBump } from '@/lib/dataSync'
import { formatDateTimeInChina } from '@/lib/date-utils'
import { Toggle } from '@/components/ui/Toggle'
import { ListState } from '@/components/ui/ListState'
import { Modal } from '@/components/ui/Modal'
import { AdminBlockedPage } from '@/components/admin-blocked-page'
import { PageHeader } from '@/components/page-header'

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
  const { user } = useUser()
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

  const profileName = myProfile?.full_name ?? null

  const [scheduleTab, setScheduleTab] = useState<'full' | 'section' | 'history'>('full')
  const [nowTick, setNowTick] = useState(() => Date.now())

  // 欢迎语：显示 5 秒后淡出
  const [welcomeVisible, setWelcomeVisible] = useState(true)
  const [welcomeMounted, setWelcomeMounted] = useState(true)

  useEffect(() => {
    if (!user) return
    const fadeTimer = setTimeout(() => setWelcomeVisible(false), 5000)
    const unmountTimer = setTimeout(() => setWelcomeMounted(false), 5500)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(unmountTimer)
    }
  }, [user])

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
    <View className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg px-4 pb-safe`}>
      {/* 欢迎语（5 秒后淡出消失） */}
      {user && welcomeMounted && (
        <View
          className={`mt-4 transition-opacity py-2 duration-300 ${
            welcomeVisible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <Text className='text-sm text-text-muted'>
            {profileName ? t('home.welcomeWithName', { name: profileName }) : t('home.welcome')}
          </Text>
        </View>
      )}

      <View className='mb-3 mt-1'>
        <PageHeader
          title={
            scheduleTab === 'history'
              ? t('home.schedule.historyTitle')
              : t('home.schedule.weekTitle')
          }
          subtitle={
            scheduleTab === 'history'
              ? t('home.schedule.historySubtitle')
              : t('home.schedule.weekSubtitle')
          }
        />
        <View className='mt-2'>
          <Toggle
            options={['full', 'section', 'history']}
            value={scheduleTab}
            onChange={(v) => setScheduleTab(v as 'full' | 'section' | 'history')}
            getLabel={(k) => {
              const labels: Record<string, string> = {
                full: t('home.tabs.full'),
                section: t('home.tabs.section'),
                history: t('home.tabs.history'),
              }
              return labels[k] ?? k
            }}
          />
        </View>
      </View>

      {/* 排练列表（可滚动）：统一用原生 ScrollView，与成员页/请假页一致；
          间距用 mb-3（space-y 在 WXSS 无效） */}
      <ScrollView scrollY className='flex-1 min-h-0'>
        {/* 公告条置于滚动区内：冷启动公告到达时只影响滚动内容，
            不再顶推头部/切换器/列表整体下移（P0-6） */}
        {!announcementLoading && announcement?.content ? (
          <View className='mb-3' onClick={() => setShowAnnouncementDetail(true)}>
            <View className='flex items-center gap-2 rounded-xl border border-warning-bg bg-warning-bg/80 px-3 py-2'>
              <Text className='shrink-0 text-warning'>📢</Text>
              <View className='min-w-0 flex-1 max-h-[60px] overflow-hidden'>
                <Text className='text-xs leading-relaxed text-warning'>{announcement.content}</Text>
              </View>
            </View>
          </View>
        ) : null}
        {/* 底部留白：自定义 tabBar 固定覆盖页面底部（高 50px + 安全区），
            历史合排多时末行会被遮挡、无法滚到底，故内容底部补足留白（与成员页一致） */}
        <View className='pb-8'>
          <ListState
            loading={rehearsalsLoading}
            isEmpty={list.length === 0}
            error={rehearsalsError}
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
          <View className='max-h-[60vh] overflow-y-auto'>
            <Text className='whitespace-pre-wrap break-words text-sm leading-relaxed text-text'>
              {announcement?.content}
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  )
}
