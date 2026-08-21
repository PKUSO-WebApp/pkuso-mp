import { useEffect, useMemo, useState } from 'react'
import { View, Text } from '@tarojs/components'
import { useSchedule } from '@/hooks/useSchedule'
import { useMyProfile } from '@/hooks/useMyProfile'
import { useUser } from '@/context/user-context'
import { useThemeClass } from '@/context/theme-context'
import { AdminBlockedPage } from '@/components/admin-blocked-page'
import { useTabBarBadgeSync } from '@/components/badge-sync-context'
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
  useTabBarBadgeSync()
  const [selectedDate, setSelectedDate] = useState<string>(getLocalDateString)
  const [createOpen, setCreateOpen] = useState(false)

  // 日期变化时重新获取数据
  useEffect(() => {
    void fetch(selectedDate)
  }, [selectedDate, fetch])

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
      <View className='mb-3 mt-1 flex items-center justify-between'>
        <View>
          <Text className='text-lg font-semibold text-text'>日程预约</Text>
          <Text className='mt-1 block text-xs text-text-muted'>查看与申请排练房预约</Text>
        </View>
        <View
          className='rounded-full bg-primary px-3 py-1.5 text-label font-medium text-primary-foreground'
          onClick={() => setCreateOpen(true)}
        >
          添加预约
        </View>
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
        {loading ? (
          <Text className='block py-16 text-center text-xs text-text-muted'>加载中…</Text>
        ) : error ? (
          <Text className='block px-3 py-16 text-center text-sm text-danger'>{error}</Text>
        ) : (
          <ScheduleGantt
            schedules={filteredSchedules}
            selectedDate={selectedDate}
            user={user}
            remove={remove}
          />
        )}
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
