import { useRef, useState, useEffect, useMemo } from 'react'
import { View, Text } from '@tarojs/components'
import { TextField } from '@/components/ui/FormFields'
import {
  DateTimePicker,
  timeToIndices,
  indicesToTime,
  HOURS,
  MINUTES,
} from '@/components/ui/DateTimePicker'
import Taro from '@tarojs/taro'
import { Modal } from '@/components/ui/Modal'
import { useT } from '@/i18n'
import { ActionBar } from '@/components/ui/ActionBar'
import { usePlaceholderStyle } from '@/hooks/usePlaceholderStyle'

// 预约日期限制：今天起 7 天（与日程页浏览条一致）
function shiftDays(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 根据开始日期+开始时间，计算允许的最晚结束日期（startTime+8h 所在的那一天）
function getMaxEndDate(startDate: string, startTime: string): string {
  if (!startTime) return shiftDays(7)
  const [h, m] = startTime.split(':').map(Number)
  const dt = new Date(`${startDate}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`)
  dt.setMinutes(dt.getMinutes() + 480) // +8h
  const y = dt.getFullYear()
  const mon = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return `${y}-${mon}-${day}`
}

/**
 * 根据开始时间、开始日期、结束日期计算 endTime 可选范围。
 * 返回 { range, startIdx }：range 为 [hours, minutes]，startIdx 为 hours 在全局 HOURS 中的起始偏移。
 *
 * maxEndH = (startH + 8) % 24
 *   同天(endDate = startDate): HOURS[startH..maxEndH]
 *   跨天(endDate = startDate+1): HOURS[0..maxEndH]
 *   endDate 超出8h窗口: 全量 HOURS（日期限制已足够约束）
 * MINUTES 始终全量。
 */
function getEndTimeRange(
  startTime: string,
  startDate: string,
  endDate: string
): { range: string[][]; startIdx: number } {
  if (!startTime) return { range: [HOURS, MINUTES], startIdx: 0 }
  const [startH] = startTime.split(':').map(Number)
  const maxEndH = (startH + 8) % 24

  // 计算 endDate 与 startDate 的天数差
  const dayDiff = Math.round(
    (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000
  )

  if (maxEndH >= startH) {
    // 8h 窗口不跨午夜
    if (dayDiff === 0) {
      // 同天：限制在8h窗口内
      return { range: [HOURS.slice(startH, maxEndH + 1), MINUTES], startIdx: startH }
    }
    // 超出8h窗口：全量
    return { range: [HOURS, MINUTES], startIdx: 0 }
  }
  // 8h 窗口跨午夜
  if (dayDiff === 0) {
    // 同天：允许到23点
    return { range: [HOURS.slice(startH, HOURS.length), MINUTES], startIdx: startH }
  }
  if (dayDiff === 1) {
    // 次日：限制在0..maxEndH（含00:00）
    return { range: [HOURS.slice(0, maxEndH + 1), MINUTES], startIdx: 0 }
  }
  // 超出8h窗口：全量
  return { range: [HOURS, MINUTES], startIdx: 0 }
}

type Props = {
  open: boolean
  /** 默认预约日期（取自日程页当前选中日） */
  defaultDate: string
  /** 提交中（来自页面 useSchedule.saving） */
  saving: boolean
  /** 写入预约：返回是否成功；成功由页面负责刷新列表 */
  onCreate: (payload: { title: string; start_time: string; end_time: string }) => Promise<boolean>
  /** 冲突检查：返回冲突文案（null 表示无冲突） */
  onCheckConflict: (
    startDate: string,
    startTime: string,
    endDate: string,
    endTime: string
  ) => Promise<string | null>
  onClose: () => void
}

/**
 * 添加排练房预约弹窗（支持跨天预约）。
 * 标题 + 开始时间（日期+时间）+ 结束时间（日期+时间）。
 * 写入的 start_time/end_time 用空格分隔（YYYY-MM-DD HH:mm:ss），与库内存储格式一致
 * （useSchedule 读取后再归一化为 T 分隔）。
 * 双重 guard 防重复提交；提交前先 checkConflict 阻止时间重叠。
 */
export function CreateScheduleModal({
  open,
  defaultDate,
  saving,
  onCreate,
  onCheckConflict,
  onClose,
}: Props) {
  const { t } = useT()
  const placeholderStyle = usePlaceholderStyle()
  const [title, setTitle] = useState('')
  const [startDate, setStartDate] = useState(defaultDate)
  const [startTime, setStartTime] = useState('')
  const [endDate, setEndDate] = useState(defaultDate)
  const [endTime, setEndTime] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // endTime 可选范围及全局偏移
  const { range: endTimeRange, startIdx: endTimeStartIdx } = useMemo(
    () => getEndTimeRange(startTime, startDate, endDate),
    [startTime, startDate, endDate]
  )

  // 当 startTime 或 startDate 变化时，自动修正 endTime：
  // - start >= end → end = start + 1h
  // - end > start + 8h → end = start + 8h
  useEffect(() => {
    if (!startTime || !endTime) return
    const [sh, sm] = startTime.split(':').map(Number)
    const [eh, em] = endTime.split(':').map(Number)
    const startMin = sh * 60 + sm
    const endMin = eh * 60 + em
    const endDayOffset = (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000
    const endTotalMin = endDayOffset * 24 * 60 + endMin

    const plus1 = startMin + 60
    const plus1Day = Math.floor(plus1 / 1440)
    const plus1T = plus1 % 1440
    const plus8 = startMin + 480
    const plus8Day = Math.floor(plus8 / 1440)
    const plus8T = plus8 % 1440
    const fmt = (m: number) =>
      `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    const addDays = (d: string, n: number) => {
      const dt = new Date(d)
      dt.setDate(dt.getDate() + n)
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    }

    if (endTotalMin <= startMin) {
      setEndDate(addDays(startDate, plus1Day))
      setEndTime(fmt(plus1T))
    } else if (endTotalMin > plus8) {
      setEndDate(addDays(startDate, plus8Day))
      setEndTime(fmt(plus8T))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime, startDate])

  // 仅在打开弹窗时复位表单
  useEffect(() => {
    if (open) {
      setTitle('')
      setStartDate(defaultDate)
      setStartTime('')
      setEndDate(defaultDate)
      setEndTime('')
      setError(null)
    }
  }, [open, defaultDate])

  const handleClose = () => {
    if (isSubmitting) return
    setError(null)
    onClose()
  }

  const handleSubmit = async () => {
    if (submittingRef.current || isSubmitting) return
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError(t('schedule.errors.titleRequired'))
      return
    }
    if (!startTime) {
      setError(t('schedule.errors.startTimeRequired'))
      return
    }
    if (!endTime) {
      setError(t('schedule.errors.endTimeRequired'))
      return
    }
    if (startDate === endDate && startTime === endTime) {
      setError(t('schedule.errors.timeSame'))
      return
    }

    submittingRef.current = true
    setIsSubmitting(true)
    setError(null)
    try {
      const conflict = await onCheckConflict(startDate, startTime, endDate, endTime)
      if (conflict) {
        setError(conflict)
        return
      }
      const ok = await onCreate({
        title: trimmedTitle,
        start_time: `${startDate} ${startTime}:00`,
        end_time: `${endDate} ${endTime}:00`,
      })
      if (!ok) {
        setError(t('schedule.errors.addFailed'))
        return
      }
      void Taro.showToast({ title: t('schedule.toastAdded'), icon: 'success' })
      setTitle('')
      setStartTime('')
      setEndTime('')
      onClose()
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  const busy = isSubmitting || saving

  // endTime picker 的局部索引：清空时默认 [0,0]
  const endTimeValue = endTime
    ? (() => {
        const [globalH, m] = timeToIndices(endTime)
        const localH = globalH - endTimeStartIdx
        return localH >= 0 && localH < endTimeRange[0].length ? [localH, m] : [0, 0]
      })()
    : [0, 0]

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('schedule.addReservation')}
      position='bottom'
      closeOnOverlay={!busy}
    >
      <View className='mt-2'>
        <TextField
          label={t('schedule.labels.title')}
          labelClass='block text-label text-text-muted'
          inputClass='bg-transparent py-2 text-xs text-text'
          value={title}
          onInput={(e) => {
            setTitle(e.detail.value)
            setError(null)
          }}
          disabled={busy}
          placeholder={t('schedule.placeholders.title')}
          placeholderStyle={placeholderStyle}
        />

        <DateTimePicker
          className='mt-3'
          label={t('schedule.labels.startTime')}
          labelClass='block text-label text-text-muted'
          date={startDate}
          time={startTime}
          onDateChange={(d) => {
            setStartDate(d)
            setError(null)
          }}
          onTimeChange={(tm) => {
            setStartTime(tm)
            setError(null)
          }}
          startDate={shiftDays(0)}
          endDate={shiftDays(7)}
          placeholder={t('schedule.placeholders.startTime')}
          timeMode='multiSelector'
          timeRange={[HOURS, MINUTES]}
          timeValue={timeToIndices(startTime)}
          onTimeMultiChange={(indices) => {
            setStartTime(indicesToTime(indices))
            setError(null)
          }}
        />

        <DateTimePicker
          className='mt-3'
          label={t('schedule.labels.endTime')}
          labelClass='block text-label text-text-muted'
          date={endDate}
          time={endTime}
          onDateChange={(d) => {
            setEndDate(d)
            setError(null)
          }}
          onTimeChange={(tm) => {
            setEndTime(tm)
            setError(null)
          }}
          startDate={startDate}
          endDate={getMaxEndDate(startDate, startTime)}
          placeholder={t('schedule.placeholders.endTime')}
          timeMode='multiSelector'
          timeRange={endTimeRange}
          timeValue={endTimeValue}
          onTimeMultiChange={(indices) => {
            setEndTime(indicesToTime([indices[0] + endTimeStartIdx, indices[1]]))
            setError(null)
          }}
        />

        {error && <Text className='block text-sm text-danger'>{error}</Text>}

        <ActionBar className='pt-1'>
          <View
            className='rounded-full px-4 py-1.5 text-label text-text-muted'
            onClick={busy ? undefined : () => handleClose()}
          >
            {t('common.actions.cancel')}
          </View>
          <View
            className={`rounded-full bg-primary px-4 py-1.5 text-label font-medium text-primary-foreground ${busy ? 'opacity-60' : ''}`}
            onClick={busy ? undefined : () => void handleSubmit()}
          >
            {isSubmitting ? t('schedule.submitting') : t('common.actions.confirm')}
          </View>
        </ActionBar>
      </View>
    </Modal>
  )
}
