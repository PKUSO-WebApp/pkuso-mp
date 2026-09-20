import { useLayoutEffect, useEffect, useRef, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { dataSyncBump } from '@/lib/dataSync'
import { tAppError } from '@/lib/appError'
import { useSchedule } from '@/hooks/useSchedule'
import { useMyProfile } from '@/hooks/useMyProfile'
import { useUser } from '@/context/user-context'
import { useThemeClass } from '@/context/theme-context'
import { useT, useNavTitle } from '@/i18n'
import { useOverlayOpen } from '@/lib/overlayStore'
import { AdminBlockedPage } from '@/components/admin-blocked-page'

import { ListState } from '@/components/ui/ListState'
import { getLocalDateString, formatDisplayDate } from '@/lib/date-utils'
import { DateSelector } from './components/date-selector'
import { ScheduleGantt } from './components/schedule-gantt'
import { CreateScheduleModal } from './components/create-schedule-modal'
import './index.scss'

/**
 * 日程预约页。
 * 查看排练房预约：今天起 8 天日期条 + 24 小时甘特图（预约块点击查看详情）。
 * 成员可新增预约（排练房申请写入，RLS 约束本人可见），并可删除自己创建的预约。
 * 管理端登录显示阻断页（规划 §1：admin 留在 Web）。
 */
export default function Schedule() {
  const {
    loading,
    error,
    fetch,
    getByDate,
    getAuthorName,
    ensureAuthorName,
    saving,
    create,
    checkConflict,
    remove,
  } = useSchedule()
  const { profile: myProfile } = useMyProfile()
  const { user } = useUser()
  const darkClass = useThemeClass()
  const { t } = useT()
  useNavTitle('schedule.navTitle')

  const [selectedDate, setSelectedDate] = useState<string>(getLocalDateString)
  const [createOpen, setCreateOpen] = useState(false)
  // 任意 Modal 打开时隐藏「添加预约」按钮，避免部分 iOS 上按钮浮于底部弹窗之上
  const overlayOpen = useOverlayOpen()
  // 甘特图高度：短屏保底 480px（24h×20px/h，字号不挤），长屏按可用空间撑满（无底部空白）
  const [ganttHeight, setGanttHeight] = useState(480)
  useLayoutEffect(() => {
    const measure = () => {
      try {
        Taro.createSelectorQuery()
          .select('#schedule-gantt-scroll')
          .boundingClientRect((rect) => {
            const r = Array.isArray(rect) ? rect[0] : rect
            // 取滚动视口真实高度（避开外层边框带来的 2px 偏差），向下取整消除亚像素滚动
            if (r && r.height > 0) setGanttHeight(Math.max(480, Math.floor(r.height)))
          })
          .exec()
      } catch {
        /* 非小程序环境（如单测）忽略测量 */
      }
    }
    Taro.nextTick(measure)
    if (typeof Taro.onWindowResize === 'function') Taro.onWindowResize(measure)
    return () => {
      if (typeof Taro.offWindowResize === 'function') Taro.offWindowResize(measure)
    }
  }, [])
  const selectedDateRef = useRef(selectedDate)
  selectedDateRef.current = selectedDate

  // 日期切换：同步取内存切片，零网络
  useEffect(() => {
    void fetch(selectedDate) // 兼容层：缓存命中则同步 setData
  }, [selectedDate, fetch])

  // A：每次切回本 tab 重新拉取当前日期预约，并重置全局轮询计时器。
  // 静默重取：已有数据时不翻 loading，避免切 tab 整页闪烁。
  // 跨天检测：若 selectedDate 已过期则自动切到今天，避免凌晨后仍停在昨天。
  useDidShow(() => {
    const today = getLocalDateString()
    if (selectedDateRef.current < today) {
      setSelectedDate(today)
    }
    void fetch(selectedDateRef.current, { silent: true })
    dataSyncBump()
  })

  // 下拉刷新：静默重取当前日期预约
  usePullDownRefresh(() => {
    void fetch(selectedDateRef.current, { silent: true })
    Taro.stopPullDownRefresh()
  })

  // 当前日期的预约：走 hook 内存切片（含跨天）
  const filteredSchedules = getByDate(selectedDate)

  // 管理端登录：不提供小程序管理端，显示阻断页（规划 §1：admin 留在 Web）
  // 游客模式下跳过此检查（useMyProfile 在无 user 时会误查全表）
  if (user && myProfile?.role === 'admin') {
    return <AdminBlockedPage />
  }

  return (
    <View
      className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg px-4`}
      style={{ paddingBottom: 'calc(50px + env(safe-area-inset-bottom))' }}
    >
      {/* 日期选择器 */}
      <View className='mt-3 mb-4'>
        <DateSelector selectedDate={selectedDate} onDateChange={setSelectedDate} />
      </View>

      {/* 当前日期显示 */}
      <View className='mb-4'>
        <Text className='text-base font-medium text-text'>{formatDisplayDate(selectedDate)}</Text>
      </View>

      {/* 甘特图：外层 View 用 flex-1 占满页面剩余空间（含 tabBar 预留），min-h-0 允许矮屏内部滚动；
            其实际高度由 createSelectorQuery 测量后取 max(480, 实测) 赋给甘特图，使长屏撑满、矮屏保底
            480px 不挤字。页面根已预留 tabBar 50px+安全区，故可滚到底不遮挡 */}
      <View className='relative mb-4 flex-1 min-h-0 rounded-xl border border-border bg-card'>
          <ScrollView scrollY id='schedule-gantt-scroll' className='h-full'>
            {/* 空日期由甘特图自身渲染（时间轴+网格线，无预约块）；loadingOnlyWhenEmpty=false 让 loading 时直接显示加载态，不渲染甘特图 */}
            <ListState loading={loading} loadingOnlyWhenEmpty={false} error={tAppError(t, error)}>
              <ScheduleGantt
                schedules={filteredSchedules}
                selectedDate={selectedDate}
                user={user}
                remove={remove}
                height={ganttHeight}
                getAuthorName={getAuthorName}
                ensureAuthorName={ensureAuthorName}
              />
            </ListState>
          </ScrollView>

        {/* 添加预约按钮：钉在甘特图容器右下角，不随内部滚动移动；
            任意 Modal 打开时隐藏，避免部分 iOS 上按钮盖在底部弹窗之上；
            游客模式下隐藏（未登录无法创建预约） */}
        {!overlayOpen && user && (
          <View
            className='absolute flex items-center justify-center rounded-full bg-primary px-3 py-1.5 text-label font-medium text-primary-foreground shadow-lg'
            style={{ right: '8px', bottom: '8px' }}
            onClick={() => setCreateOpen(true)}
          >
            {t('schedule.addReservation')}
          </View>
        )}
      </View>

      {/* 添加预约弹窗（成员写入排练房申请） */}
      <CreateScheduleModal
        open={createOpen}
        defaultDate={selectedDate}
        saving={saving}
        onCreate={async (p) => create({ ...p, author_id: user?.id ?? null }, selectedDate)}
        onCheckConflict={(sd, st, ed, et) => checkConflict(sd, st, ed, et)}
        onClose={() => setCreateOpen(false)}
      />
    </View>
  )
}
