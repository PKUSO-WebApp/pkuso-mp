import { useEffect, useRef, useState } from 'react'
import { View, Text } from '@tarojs/components'
import { supabase } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal'
import { parseLocalISO, formatTime } from '@/lib/date-utils'
import type { ScheduleRow } from '@/types/database'

type Props = {
  schedules: ScheduleRow[]
  selectedDate: string
}

// 7 个预约色 token（按 id 哈希分配）。
// 静态数组保证 Tailwind 源码扫描生成全部 7 个 bg-schedule-N 工具类与对应
// CSS 变量（动态拼接的类名不会被扫描到，token 定义见 app.css @theme）。
const SCHEDULE_COLORS = [
  'bg-schedule-1',
  'bg-schedule-2',
  'bg-schedule-3',
  'bg-schedule-4',
  'bg-schedule-5',
  'bg-schedule-6',
  'bg-schedule-7',
] as const

export function getScheduleColorClass(id: number): string {
  return SCHEDULE_COLORS[Math.abs(id) % SCHEDULE_COLORS.length]
}

/** 解析时间字符串为小时数（0-24，含分钟小数）；无效时间返回 0 */
export function parseTimeToHours(timeStr: string | null): number {
  if (!timeStr) return 0
  const date = parseLocalISO(timeStr)
  if (Number.isNaN(date.getTime())) return 0
  return date.getHours() + date.getMinutes() / 60
}

/** 只读甘特图：24 小时时间轴 + 预约块（demo 阶段只读，无添加/删除）。
 *  点击预约块打开详情弹窗；预约人姓名经 profiles_roster 查询，
 *  竞态守卫用 ref 记录当前选中 id（快速连点时丢弃过期响应）。 */
export function ScheduleGantt({ schedules, selectedDate }: Props) {
  const [selectedSchedule, setSelectedSchedule] = useState<ScheduleRow | null>(null)
  const [authorName, setAuthorName] = useState<string | null>(null)
  const [loadingAuthor, setLoadingAuthor] = useState(false)
  // 追踪当前查询的 schedule id，用于竞态条件判断
  const queryingScheduleId = useRef<number | null>(null)

  // 计算每个预约的位置和高度（百分比定位，容器高度 480px 对应 24 小时）
  const scheduleItems = schedules.map((schedule) => {
    const startHour = parseTimeToHours(schedule.start_time)
    const endHour = parseTimeToHours(schedule.end_time)
    const duration = endHour - startHour || 1 // 默认 1 小时
    return {
      ...schedule,
      startHour,
      duration,
      top: startHour * (100 / 24),
      height: Math.max(duration * (100 / 24), 2), // 最小高度 2%
    }
  })

  // 点击预约块：查询预约人姓名并打开弹窗
  const handleScheduleClick = async (schedule: ScheduleRow) => {
    setSelectedSchedule(schedule)
    setLoadingAuthor(true)
    setAuthorName(null)
    // 记录当前查询的 schedule id，防止竞态条件
    queryingScheduleId.current = schedule.id

    if (schedule.author_id) {
      const { data, error } = await supabase
        .from('profiles_roster')
        .select('full_name')
        .eq('id', schedule.author_id)
        .maybeSingle()
      // 仅当前选中预约的响应生效（用户可能已快速点击另一块）
      if (queryingScheduleId.current !== schedule.id) return
      if (!error && data) {
        setAuthorName((data as { full_name: string | null }).full_name || null)
        setLoadingAuthor(false)
      } else {
        setAuthorName(null)
        setLoadingAuthor(false)
      }
    } else {
      // 无 author_id：排练触发器生成的影子预约，显示 admin
      if (queryingScheduleId.current === schedule.id) {
        setAuthorName('admin')
        setLoadingAuthor(false)
      }
    }
  }

  const handleCloseModal = () => {
    setSelectedSchedule(null)
    setAuthorName(null)
  }

  // 卸载时清空查询标记（组件卸载后异步响应不应再 setState）
  useEffect(() => {
    return () => {
      queryingScheduleId.current = null
    }
  }, [])

  return (
    <>
      <View className='relative flex w-full' style={{ height: '480px' }}>
        {/* 左侧时间轴（随容器同步滚动） */}
        <View className='flex w-12 flex-shrink-0 flex-col bg-gantt-sidebar'>
          {Array.from({ length: 24 }).map((_, hour) => (
            <View
              key={hour}
              className={`flex items-start justify-center pt-1 text-xs text-text-muted ${
                hour % 4 === 0 ? 'font-medium' : ''
              } ${hour % 4 === 0 && hour !== 0 ? 'border-t-2 border-text' : 'border-t border-border'}`}
              style={{ height: `${100 / 24}%` }}
            >
              <Text>{`${String(hour).padStart(2, '0')}:00`}</Text>
            </View>
          ))}
        </View>

        {/* 右侧甘特图区域 */}
        <View className='relative flex-1'>
          {/* 小时分隔线 */}
          {Array.from({ length: 24 }).map((_, hour) => (
            <View
              key={hour}
              className={`absolute left-0 right-0 ${
                hour % 4 === 0 && hour !== 0 ? 'border-b-2 border-text' : 'border-b border-border'
              }`}
              style={{ top: `${(hour / 24) * 100}%` }}
            />
          ))}

          {/* 预约块 */}
          {scheduleItems.map((schedule) => (
            <View
              key={schedule.id}
              className={`absolute left-2 right-2 rounded-lg ${getScheduleColorClass(schedule.id)}`}
              style={{
                top: `${schedule.top}%`,
                height: `${schedule.height}%`,
              }}
              onClick={() => void handleScheduleClick(schedule)}
            >
              <View className='flex h-full flex-col justify-center px-2 py-1'>
                <Text className='block truncate text-xs font-medium text-schedule-text'>
                  {schedule.title || '未命名预约'}
                </Text>
                <Text className='block text-xs text-schedule-text-muted'>
                  {formatTime(schedule.start_time)} - {formatTime(schedule.end_time)}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* 预约详情弹窗（只读） */}
      <Modal
        open={!!selectedSchedule}
        onClose={handleCloseModal}
        title='预约详情'
        position='bottom'
      >
        {selectedSchedule && (
          <View className='mt-2 space-y-3'>
            <View>
              <Text className='mb-1 block text-xs text-text-muted'>标题</Text>
              <Text className='block text-sm font-medium text-text'>
                {selectedSchedule.title || '未命名预约'}
              </Text>
            </View>
            <View>
              <Text className='mb-1 block text-xs text-text-muted'>时间</Text>
              <Text className='block text-sm text-text'>
                {formatTime(selectedSchedule.start_time)} - {formatTime(selectedSchedule.end_time)}
              </Text>
            </View>
            <View>
              <Text className='mb-1 block text-xs text-text-muted'>日期</Text>
              <Text className='block text-sm text-text'>{selectedDate}</Text>
            </View>
            <View>
              <Text className='mb-1 block text-xs text-text-muted'>预约人</Text>
              <Text className='block text-sm text-text'>
                {loadingAuthor ? '加载中…' : authorName || '未知'}
              </Text>
            </View>
          </View>
        )}
      </Modal>
    </>
  )
}
