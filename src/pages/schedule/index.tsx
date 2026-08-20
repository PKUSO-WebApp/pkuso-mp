import { useEffect, useMemo, useState } from 'react'
import { View, Text } from '@tarojs/components'
import { useSchedule } from '@/hooks/useSchedule'
import { useMyProfile } from '@/hooks/useMyProfile'
import { AdminBlockedPage } from '@/components/admin-blocked-page'
import { getLocalDateString, parseLocalISO, formatDisplayDate } from '@/lib/date-utils'
import { DateSelector } from './components/date-selector'
import { ScheduleGantt } from './components/schedule-gantt'
import './index.scss'

/**
 * 日程预约页（demo 范围：只读甘特图）。
 * 查看排练房预约：今天起 8 天日期条 + 24 小时甘特图（预约块点击查看详情）。
 * 添加/删除预约暂缓（demo 后补，规划 §8.5「demo 阶段可先只读」）。
 * 管理端登录显示阻断页（规划 §1：admin 留在 Web）。
 */
export default function Schedule() {
  const { data: schedules, loading, error, fetch } = useSchedule()
  const { profile: myProfile } = useMyProfile()
  const [selectedDate, setSelectedDate] = useState<string>(getLocalDateString)

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
    <View className='flex h-full min-h-0 flex-col px-4 pb-safe'>
      {/* 头部 */}
      <View className='mt-1 mb-3'>
        <Text className='text-lg font-semibold text-text'>日程预约</Text>
        <Text className='mt-1 block text-xs text-text-muted'>查看排练房预约（只读）</Text>
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
          <ScheduleGantt schedules={filteredSchedules} selectedDate={selectedDate} />
        )}
      </View>
    </View>
  )
}
