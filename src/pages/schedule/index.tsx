import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { dataSyncBump } from '@/lib/dataSync'
import { useSchedule } from '@/hooks/useSchedule'
import { useMyProfile } from '@/hooks/useMyProfile'
import { useUser } from '@/context/user-context'
import { useThemeClass } from '@/context/theme-context'
import { useT, useNavTitle } from '@/i18n'
import { AdminBlockedPage } from '@/components/admin-blocked-page'

import { PageHeader } from '@/components/page-header'
import { ListState } from '@/components/ui/ListState'
import { getLocalDateString, parseLocalISO, formatDisplayDate } from '@/lib/date-utils'
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
    data: schedules,
    loading,
    error,
    fetch,
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
  const selectedDateRef = useRef(selectedDate)
  selectedDateRef.current = selectedDate

  // 日期变化时重新获取数据
  useEffect(() => {
    void fetch(selectedDate)
  }, [selectedDate, fetch])

  // A：每次切回本 tab 重新拉取当前日期预约，并重置全局轮询计时器。
  // 静默重取：已有数据时不翻 loading，避免切 tab 整页闪烁
  useDidShow(() => {
    void fetch(selectedDateRef.current, { silent: true })
    dataSyncBump()
  })

  // 过滤当前日期的预约（后端已按日期筛选，这里做二次过滤确保准确）
  const filteredSchedules = useMemo(
    () =>
      schedules.filter((schedule) => {
        const date = parseLocalISO(schedule.start_time)
        // 本地日期比较，避免时区问题
        const scheduleDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        return scheduleDate === selectedDate
      }),
    [schedules, selectedDate]
  )

  // 管理端登录：不提供小程序管理端，显示阻断页（规划 §1：admin 留在 Web）
  if (myProfile?.role === 'admin') {
    return <AdminBlockedPage />
  }

  return (
    <View className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg px-4 pb-safe`}>
      {/* 头部 */}
      <View className='mb-3 mt-1'>
        <PageHeader
          title={t('schedule.title')}
          subtitle={t('schedule.subtitle')}
          rightButton={
            <View
              className='rounded-full bg-primary px-3 py-1.5 text-label font-medium text-primary-foreground'
              onClick={() => setCreateOpen(true)}
            >
              {t('schedule.addReservation')}
            </View>
          }
        />
      </View>

      {/* 日期选择器 */}
      <View className='mb-4'>
        <DateSelector selectedDate={selectedDate} onDateChange={setSelectedDate} />
      </View>

      {/* 当前日期显示 */}
      <View className='mb-4'>
        <Text className='text-base font-medium text-text'>{formatDisplayDate(selectedDate)}</Text>
      </View>

      {/* 甘特图：flex-1 占满剩余空间，内部独立滚动 */}
      <View className='mb-4 flex-1 min-h-0 overflow-y-auto rounded-xl border border-border bg-card'>
        {/* 无独立空态分支：空日期由甘特图自身渲染；isEmpty 恒 false 仅复用 loading/error 门控 */}
        <ListState loading={loading} isEmpty={false} error={error}>
          <ScheduleGantt
            schedules={filteredSchedules}
            selectedDate={selectedDate}
            user={user}
            remove={remove}
          />
        </ListState>
      </View>

      {/* 添加预约弹窗（成员写入排练房申请） */}
      <CreateScheduleModal
        open={createOpen}
        defaultDate={selectedDate}
        saving={saving}
        onCreate={async (p) => create({ ...p, author_id: user?.id ?? null }, selectedDate)}
        onCheckConflict={(d, s, e) => checkConflict(d, s, e)}
        onClose={() => setCreateOpen(false)}
      />
    </View>
  )
}
