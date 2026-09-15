import { useEffect, useRef, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal'
import { parseLocalISO, formatTime } from '@/lib/date-utils'
import { useT } from '@/i18n'
import type { ScheduleRow } from '@/types/database'

type Props = {
  schedules: ScheduleRow[]
  selectedDate: string
  /** 当前用户（用于判定是否为预约创建者，仅创建者可删除） */
  user?: { id: string | undefined } | null
  /** 删除预约（仅创建者本人可删除自己添加的预约） */
  remove: (id: number, date?: string) => Promise<boolean>
  /** 甘特图高度（px）：短屏保底 480，长屏按可用空间撑满；默认 480 */
  height?: number
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

/** 解析时间字符串为小时数（0-24，含分钟小数）；无效时间返回 0。 */
export function parseTimeToHours(timeStr: string | null): number {
  if (!timeStr) return 0
  const date = parseLocalISO(timeStr)
  if (Number.isNaN(date.getTime())) return 0
  return date.getHours() + date.getMinutes() / 60
}

/** 只读甘特图：24 小时时间轴 + 预约块（demo 阶段只读，无添加/删除）。
 *  点击预约块打开详情弹窗；预约人姓名经 profiles_roster 查询，
 *  竞态守卫用 ref 记录当前选中 id（快速连点时丢弃过期响应）。 */
export function ScheduleGantt({ schedules, selectedDate, user, remove, height = 480 }: Props) {
  const { t } = useT()
  const [selectedSchedule, setSelectedSchedule] = useState<ScheduleRow | null>(null)
  const [authorName, setAuthorName] = useState<string | null>(null)
  const [loadingAuthor, setLoadingAuthor] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // 追踪当前查询的 schedule id，用于竞态条件判断
  const queryingScheduleId = useRef<number | null>(null)

  // 当前用户是否为该预约的创建者（仅创建者可删除，Issue #142 移植）
  const isAuthor = selectedSchedule?.author_id === user?.id

  // 删除预约：先确认，再调用 remove，成功后关闭弹窗；失败保留弹窗并提示
  const handleDelete = async () => {
    if (!selectedSchedule) return
    const res = await Taro.showModal({
      title: t('schedule.deleteReservation'),
      content: t('schedule.deleteConfirm', {
        title: selectedSchedule.title || t('schedule.unnamed'),
      }),
    })
    if (!res.confirm) return
    setDeleting(true)
    setDeleteError(null)
    const success = await remove(selectedSchedule.id, selectedDate)
    setDeleting(false)
    if (success) {
      handleCloseModal()
    } else {
      setDeleteError(t('schedule.errors.deleteFailed'))
    }
  }

  // 计算每个预约的位置和高度（百分比定位，容器高度 480px 对应 24 小时）
  // 支持跨天预约：预约块在参与的每一天都显示
  const scheduleItems = schedules.map((schedule) => {
    const startHour = parseTimeToHours(schedule.start_time)
    const endHour = parseTimeToHours(schedule.end_time)
    
    const scheduleStartDate = schedule.start_time?.split('T')[0] || ''
    const scheduleEndDate = schedule.end_time?.split('T')[0] || ''

    // 跨天且结束时间为 00:00：仅在开始天显示，结束天不显示（00:00 即前一天 24:00）
    const isCrossDayMidnightEnd = scheduleStartDate !== scheduleEndDate && endHour === 0

    let displayStartHour = 0
    let displayEndHour = 0
    let shouldRender = true

    if (scheduleStartDate === scheduleEndDate) {
      // 同天预约
      displayStartHour = startHour
      displayEndHour = endHour
    } else if (selectedDate === scheduleStartDate) {
      // 预约的开始天：显示从开始时间到24:00
      displayStartHour = startHour
      displayEndHour = 24
    } else if (selectedDate === scheduleEndDate) {
      if (isCrossDayMidnightEnd) {
        // 结束天是 00:00，不渲染（已在开始天闭合为 24:00）
        shouldRender = false
      } else {
        // 预约的结束天：显示从00:00到结束时间
        displayStartHour = 0
        displayEndHour = endHour
      }
    } else {
      // 中间天：不显示（理论上不会出现，因为查询已过滤）
      shouldRender = false
    }
    
    if (!shouldRender) {
      return {
        ...schedule,
        startHour: 0,
        duration: 0,
        top: 0,
        height: 0,
        displayTimeRange: undefined,
        hidden: true,
      } as const
    }

    const duration = displayEndHour - displayStartHour || 1
    const displayTimeRange =
      scheduleStartDate === scheduleEndDate
        ? undefined // 同天预约，用原始时间
        : selectedDate === scheduleStartDate
          ? `${formatTime(schedule.start_time)} – 24:00`
          : `00:00 – ${formatTime(schedule.end_time)}`

    return {
      ...schedule,
      startHour: displayStartHour,
      duration,
      top: displayStartHour * (100 / 24),
      height: Math.max(duration * (100 / 24), 2),
      displayTimeRange,
      hidden: false,
    } as const
  })

  // 点击预约块：查询预约人姓名并打开弹窗
  const handleScheduleClick = async (schedule: ScheduleRow) => {
    setSelectedSchedule(schedule)
    // 游客模式下不查询预约人信息
    if (!user) {
      setLoadingAuthor(false)
      setAuthorName(null)
      queryingScheduleId.current = schedule.id
      return
    }
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
      <View className='relative flex w-full' style={{ height: `${height}px`, flexShrink: 0 }}>
        {/* 左侧时间轴（随容器同步滚动） */}
        <View className='flex w-12 flex-shrink-0 flex-col bg-gantt-sidebar'>
          {Array.from({ length: 24 }).map((_, hour) => (
            <View
              key={hour}
              className={`flex items-start justify-center pt-1 text-xs text-gantt-sidebar-text ${
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
          {/* 小时分隔线：与左侧时间轴一致用 border-t（顶边），确保两侧分隔线在同一位置
              （border-b 在 0 高度绝对定位元素上会向上偏移 1px，造成 7:00/19:00 等处的错位） */}
          {Array.from({ length: 24 }).map((_, hour) => (
            <View
              key={hour}
              className={`absolute left-0 right-0 ${
                hour % 4 === 0 && hour !== 0 ? 'border-t-2 border-text' : 'border-t border-border'
              }`}
              style={{ top: `${(hour / 24) * 100}%` }}
            />
          ))}

          {/* 预约块 */}
          {scheduleItems
            .filter((s) => !s.hidden)
            .map((schedule) => {
            const isSelfBlock = schedule.author_id === user?.id
            const colorClass = isSelfBlock
              ? getScheduleColorClass(schedule.id)
              : 'bg-schedule-other'
            const titleCls = isSelfBlock ? 'text-schedule-text' : 'text-primary'
            const subCls = isSelfBlock ? 'text-schedule-text-muted' : 'text-primary'
            return (
              <View
                key={schedule.id}
                className={`absolute left-2 right-2 rounded-lg border border-text ${colorClass}`}
                style={{
                  top: `${schedule.top}%`,
                  height: `${schedule.height}%`,
                }}
                onClick={() => void handleScheduleClick(schedule)}
              >
                <View className='flex h-full flex-col justify-center px-2 py-1'>
                  <Text className={`block truncate text-xs font-medium ${titleCls}`}>
                    {schedule.title || t('schedule.unnamed')}
                  </Text>
                  <Text className={`block text-xs ${subCls}`}>
                    {schedule.displayTimeRange ??
                      `${formatTime(schedule.start_time)} – ${formatTime(schedule.end_time)}`}
                  </Text>
                </View>
              </View>
            )
          })}
        </View>
      </View>

      {/* 预约详情弹窗（只读） */}
      <Modal
        open={!!selectedSchedule}
        onClose={handleCloseModal}
        title={t('schedule.detailTitle')}
        position='bottom'
      >
        {selectedSchedule && (
          <View className='mt-2'>
            <View>
              <Text className='mb-1 block text-xs text-text-muted'>
                {t('schedule.detail.title')}
              </Text>
              <Text className='block text-sm font-medium text-text'>
                {selectedSchedule.title || t('schedule.unnamed')}
              </Text>
            </View>
            <View className='mt-3'>
              <Text className='mb-1 block text-xs text-text-muted'>
                {t('schedule.detail.time')}
              </Text>
              <Text className='block text-sm text-text'>
                {(() => {
                  const startDate = selectedSchedule.start_time?.split('T')[0] || ''
                  const endDate = selectedSchedule.end_time?.split('T')[0] || ''
                  const startTime = formatTime(selectedSchedule.start_time)
                  const endTime = formatTime(selectedSchedule.end_time)
                  const endHour = parseTimeToHours(selectedSchedule.end_time)
                  if (startDate === endDate) {
                    return `${startDate} ${startTime} – ${endTime}`
                  }
                  return `${startDate} ${startTime} – ${endDate} ${endHour === 0 ? '24:00' : endTime}`
                })()}
              </Text>
            </View>
            {/* 预约人信息：仅登录用户可见 */}
            {user && (
              <View className='mt-3'>
                <Text className='mb-1 block text-xs text-text-muted'>
                  {t('schedule.detail.author')}
                </Text>
                <Text className='block text-sm text-text'>
                  {loadingAuthor
                    ? t('common.actions.loading')
                    : authorName || t('schedule.unknown')}
                </Text>
              </View>
            )}
            {/* 仅创建者可删除自己添加的预约（Issue #142 移植） */}
            {isAuthor && (
              <View className='mt-3 border-t border-border pt-2'>
                <View
                  className={`rounded-lg bg-danger py-2 text-center text-sm font-medium text-white ${
                    deleting ? 'opacity-50' : ''
                  }`}
                  onClick={deleting ? undefined : () => void handleDelete()}
                >
                  {deleting ? t('schedule.deleting') : t('schedule.deleteReservation')}
                </View>
                {deleteError && (
                  <Text className='mt-2 block text-center text-sm text-danger'>{deleteError}</Text>
                )}
              </View>
            )}
          </View>
        )}
      </Modal>
    </>
  )
}
