import { View, Text, Picker } from '@tarojs/components'
import type { ReactNode } from 'react'

type Props = {
  /** 标签 */
  label?: ReactNode
  /** 标签样式类 */
  labelClass?: string
  /** 日期值（YYYY-MM-DD） */
  date: string
  /** 时间值（HH:mm） */
  time: string
  /** 日期变化回调 */
  onDateChange: (date: string) => void
  /** 时间变化回调 */
  onTimeChange: (time: string) => void
  /** 可选日期范围：开始日期 */
  startDate?: string
  /** 可选日期范围：结束日期 */
  endDate?: string
  /** 可选时间范围：开始时间（HH:mm） */
  startTime?: string
  /** 可选时间范围：结束时间（HH:mm） */
  endTime?: string
  /** 占位文本 */
  placeholder?: string
  /** 是否禁用 */
  disabled?: boolean
  /** 外层容器类 */
  className?: string
  /** 时间选择器的mode，支持 time 或 multiSelector */
  timeMode?: 'time' | 'multiSelector'
  /** 时间选择器的range（multiSelector模式） */
  timeRange?: string[][]
  /** 时间选择器的value（multiSelector模式） */
  timeValue?: number[]
  /** 时间选择器的onChange（multiSelector模式） */
  onTimeMultiChange?: (value: number[]) => void
}

// 时间选择最小单位 15 分钟：分钟列仅提供 00/15/30/45 四档
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '15', '30', '45']

export function timeToIndices(time: string): [number, number] {
  if (!time) return [9, 0]
  if (!/^\d{1,2}:\d{2}$/.test(time)) return [9, 0]
  const [h, m] = time.split(':')
  const hi = HOURS.indexOf(h.padStart(2, '0'))
  const mi = Math.min(MINUTES.length - 1, Math.max(0, Math.round(Number(m) / 15)))
  return [hi < 0 ? 9 : hi, mi]
}

export function indicesToTime(indices: number[]): string {
  const hi = indices?.[0] ?? 9
  const h = HOURS[hi] ?? '09'
  const m = MINUTES[indices?.[1] ?? 0] ?? '00'
  return `${h}:${m}`
}

export { HOURS, MINUTES }

/** 日期时间选择器：左右两个分开的input box，中间有间隔，日期:时间 = 3:1 */
export function DateTimePicker({
  label,
  labelClass = 'block text-xs font-medium text-text-muted',
  date,
  time,
  onDateChange,
  onTimeChange,
  startDate,
  endDate,
  startTime,
  endTime,
  placeholder,
  disabled = false,
  className = '',
  timeMode = 'multiSelector',
  timeRange,
  timeValue,
  onTimeMultiChange,
}: Props) {
  const displayTime = time || placeholder

  return (
    <View className={className}>
      {label && <Text className={labelClass}>{label}</Text>}
      <View className='mt-1 flex w-full gap-2'>
        {/* 日期选择器（占3份宽度） */}
        <Picker
          mode='date'
          value={date}
          start={startDate}
          end={endDate}
          disabled={disabled}
          onChange={(e) => onDateChange(e.detail.value)}
          className='flex-[3] overflow-hidden rounded-xl border border-border bg-muted py-2 px-3'
        >
          <Text className='text-xs text-text'>{date}</Text>
        </Picker>

        {/* 时间选择器（占1份宽度） */}
        {timeMode === 'time' ? (
          <Picker
            mode='time'
            value={time}
            start={startTime}
            end={endTime}
            disabled={disabled}
            onChange={(e) => onTimeChange(e.detail.value)}
            className='flex-[1] overflow-hidden rounded-xl border border-border bg-muted py-2 px-3'
          >
            <Text className='text-xs text-text'>{displayTime}</Text>
          </Picker>
        ) : (
          <Picker
            mode='multiSelector'
            range={timeRange ?? [HOURS, MINUTES]}
            value={timeValue ?? timeToIndices(time)}
            disabled={disabled}
            onChange={(e) => onTimeMultiChange?.(e.detail.value)}
            className='flex-[1] overflow-hidden rounded-xl border border-border bg-muted py-2 px-3'
          >
            <Text className='text-xs text-text'>{displayTime}</Text>
          </Picker>
        )}
      </View>
    </View>
  )
}
