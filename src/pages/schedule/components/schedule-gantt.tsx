import { useState } from 'react'
import { View, Text, Textarea } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Modal } from '@/components/ui/Modal'
import { parseLocalISO, formatTime } from '@/lib/date-utils'
import { useT } from '@/i18n'
import { useMyCapabilities } from '@/hooks/useMyCapabilities'
import { usePlaceholderStyle } from '@/hooks/usePlaceholderStyle'
import type { ScheduleRow } from '@/types/database'

type Props = {
  schedules: ScheduleRow[]
  selectedDate: string
  /** 当前用户（用于判定是否为预约创建者；创建者/团长可删除人工预约） */
  user?: { id: string | undefined } | null
  /** 删除人工预约（影子预约不走这里，由排练详情页删除排练） */
  remove: (id: number, date?: string, reason?: string) => Promise<boolean>
  /** 甘特图高度（px）：短屏保底 480，长屏按可用空间撑满；默认 480 */
  height?: number
  /** 同步读取作者名缓存（命中即时返回，未命中返回 null） */
  getAuthorName: (authorId: string | null) => string | null
  /** 异步获取作者名（缓存未命中时发网络请求并填充缓存） */
  ensureAuthorName: (authorId: string | null) => Promise<string | null>
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

/** 只读甘特图：24 小时时间轴 + 预约块。
 *  点击预约块打开详情弹窗；预约人姓名从 useSchedule 缓存同步读取，
 *  缓存未命中时异步获取并填充。 */
export function ScheduleGantt({
  schedules,
  selectedDate,
  user,
  remove,
  height = 480,
  getAuthorName,
  ensureAuthorName,
}: Props) {
  const { t } = useT()
  const placeholderStyle = usePlaceholderStyle()
  const { hasCapability } = useMyCapabilities()
  const canManageRehearsals = hasCapability('rehearsal')
  const [selectedSchedule, setSelectedSchedule] = useState<ScheduleRow | null>(null)
  const [displayAuthorName, setDisplayAuthorName] = useState<string | null>(null)
  const [loadingAuthor, setLoadingAuthor] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  /** 团长删别人的预约：先填原因（会发给作者） */
  const [deleteReasonOpen, setDeleteReasonOpen] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')

  // 当前用户是否为该预约的创建者（Issue #142 移植）
  const isAuthor = selectedSchedule?.author_id === user?.id
  const isRehearsalSchedule = !!selectedSchedule?.rehearsal_id
  // 影子预约不能直接删（删了排练还在）：团长从详情弹窗跳去排练详情页删排练
  const canDelete = !isRehearsalSchedule && (isAuthor || canManageRehearsals)
  // 团长删别人的预约要先填原因；删自己的不需要
  const deletingOthers = !!selectedSchedule?.author_id && !isAuthor

  // 真正删除（reason 仅用于「团长删别人的预约」）
  const performDelete = async (reason?: string) => {
    if (!selectedSchedule || selectedSchedule.rehearsal_id) return
    setDeleting(true)
    setDeleteError(null)
    const success = reason
      ? await remove(selectedSchedule.id, selectedDate, reason)
      : await remove(selectedSchedule.id, selectedDate)
    setDeleting(false)
    if (success) {
      handleCloseModal()
    } else {
      setDeleteError(t('schedule.errors.deleteFailed'))
    }
  }

  // 作者删自己的 / 无作者的孤儿：普通确认，无需原因
  const handleDelete = async () => {
    if (!selectedSchedule || selectedSchedule.rehearsal_id) return
    const res = await Taro.showModal({
      title: t('schedule.deleteReservation'),
      content: t('schedule.deleteConfirm', {
        title: selectedSchedule.title || t('schedule.unnamed'),
      }),
    })
    if (!res.confirm) return
    await performDelete()
  }

  // 团长删别人的预约：先填原因（后端会发给作者）
  const handleDeleteOthers = () => {
    if (!selectedSchedule || selectedSchedule.rehearsal_id) return
    setDeleteReason('')
    setDeleteError(null)
    setDeleteReasonOpen(true)
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

  // 点击预约块：从缓存同步读取作者名，未命中时异步获取
  const handleScheduleClick = (schedule: ScheduleRow) => {
    setSelectedSchedule(schedule)
    // 游客模式下不查询预约人信息
    if (!user) {
      setDisplayAuthorName(null)
      setLoadingAuthor(false)
      return
    }

    if (!schedule.author_id) {
      // 无 author_id：排练触发器生成的影子预约，显示 admin
      setDisplayAuthorName('admin')
      setLoadingAuthor(false)
      return
    }

    // 同步读取缓存
    const cached = getAuthorName(schedule.author_id)
    if (cached) {
      setDisplayAuthorName(cached)
      setLoadingAuthor(false)
      return
    }

    // 缓存未命中：异步获取
    setLoadingAuthor(true)
    setDisplayAuthorName(null)
    void ensureAuthorName(schedule.author_id).then((name) => {
      setDisplayAuthorName(name)
      setLoadingAuthor(false)
    })
  }

  const handleCloseModal = () => {
    setSelectedSchedule(null)
    setDisplayAuthorName(null)
    setDeleteReasonOpen(false)
    setDeleteReason('')
    setDeleteError(null)
  }

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
                    : displayAuthorName || t('schedule.unknown')}
                </Text>
              </View>
            )}
            {isRehearsalSchedule ? (
              // 影子预约：删除入口引导到排练详情页（那里有「删除排练」，FK 会级联删影子）
              canManageRehearsals && selectedSchedule.rehearsal_id ? (
                <View className='mt-3 border-t border-border pt-2'>
                  <Text className='mb-2 block text-xs text-text-muted'>
                    {t('schedule.rehearsalShadowHint')}
                  </Text>
                  <View
                    className='rounded-lg bg-primary py-2 text-center'
                    onClick={() =>
                      void Taro.navigateTo({
                        url: `/pages/president-rehearsal-detail/index?id=${selectedSchedule.rehearsal_id}`,
                      })
                    }
                  >
                    <Text className='text-sm font-medium text-primary-foreground'>
                      {t('schedule.openRehearsalDelete')}
                    </Text>
                  </View>
                </View>
              ) : null
            ) : canDelete ? (
              // 人工预约：作者本人或团长（rehearsal 能力）可删除
              <View className='mt-3 border-t border-border pt-2'>
                <View
                  className={`rounded-lg bg-danger py-2 text-center ${
                    deleting ? 'opacity-50' : ''
                  }`}
                  onClick={
                    deleting
                      ? undefined
                      : deletingOthers
                        ? handleDeleteOthers
                        : () => void handleDelete()
                  }
                >
                  <Text className='text-sm font-medium text-danger-foreground'>
                    {deleting ? t('schedule.deleting') : t('schedule.deleteReservation')}
                  </Text>
                </View>
                {deleteError && (
                  <Text className='mt-2 block text-center text-sm text-danger'>{deleteError}</Text>
                )}
              </View>
            ) : null}
          </View>
        )}
      </Modal>

      {/* 团长删别人的预约：原因会随系统通知发给作者 */}
      <Modal
        open={deleteReasonOpen}
        onClose={() => !deleting && setDeleteReasonOpen(false)}
        title={t('schedule.deleteReasonTitle')}
        position='center'
        closeOnOverlay={!deleting}
      >
        <Text className='block text-sm text-text-muted'>
          {t('schedule.deleteReasonPrompt', {
            title: selectedSchedule?.title || t('schedule.unnamed'),
          })}
        </Text>
        <View className='mt-3 w-full overflow-hidden rounded-xl border border-border bg-muted px-3 py-2'>
          <Textarea
            value={deleteReason}
            className='h-20 w-full bg-transparent text-sm text-text'
            placeholder={t('schedule.deleteReasonPlaceholder')}
            placeholderStyle={placeholderStyle}
            maxlength={200}
            onInput={(event) => setDeleteReason(event.detail.value)}
          />
        </View>
        {deleteError && <Text className='mt-2 block text-sm text-danger'>{deleteError}</Text>}
        <View className='mt-4 flex gap-2'>
          <View
            className='flex-1 rounded-xl border border-border bg-surface py-2 text-center'
            onClick={() => {
              if (!deleting) setDeleteReasonOpen(false)
            }}
          >
            <Text className='text-sm text-text'>{t('common.actions.cancel')}</Text>
          </View>
          <View
            className={`flex-1 rounded-xl py-2 text-center ${
              deleteReason.trim() && !deleting ? 'bg-danger' : 'bg-muted'
            }`}
            onClick={() => {
              if (!deleteReason.trim() || deleting) return
              void performDelete(deleteReason.trim())
            }}
          >
            <Text
              className={`text-sm font-medium ${
                deleteReason.trim() && !deleting ? 'text-danger-foreground' : 'text-text-muted'
              }`}
            >
              {deleting ? t('schedule.deleting') : t('schedule.deleteReservation')}
            </Text>
          </View>
        </View>
      </Modal>
    </>
  )
}
