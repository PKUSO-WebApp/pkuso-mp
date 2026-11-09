import { View, Text } from '@tarojs/components'
import { useT } from '@/i18n'
import type { StatusTone } from '@/components/ui/StatusChip'
import { dayTone, monthGrid, type AttendanceRowLike } from '@/lib/attendance-calendar'

const TONE_BG: Record<StatusTone, string> = {
  success: 'bg-success-bg',
  danger: 'bg-danger-bg',
  warning: 'bg-warning-bg',
  info: 'bg-info-bg',
  neutral: 'bg-muted',
}

const TONE_TEXT: Record<StatusTone, string> = {
  success: 'text-success',
  danger: 'text-danger',
  warning: 'text-warning',
  info: 'text-info',
  neutral: 'text-text',
}

/** 一周七天等宽（Tailwind 没有 w-1/7，用内联百分比） */
const CELL_WIDTH = `${100 / 7}%`

/**
 * 成员考勤月历（0.6.2）。
 *
 * - 有排练的日期可点；阴影色 = 当天已过去的场次里最严重的状态（见 lib/attendance-calendar）；
 * - 未来 / 无需出勤不画阴影；点击仍可展开（便于把存量 exempt 改成其他状态）；
 * - 月份由父组件持有，前后翻月只改父状态。
 */
export function AttendanceCalendar({
  year,
  month,
  byDate,
  selectedDate,
  onSelect,
  onMonthChange,
  now,
}: {
  year: number
  month: number
  byDate: Map<string, AttendanceRowLike[]>
  selectedDate: string | null
  onSelect: (dateKey: string) => void
  onMonthChange: (delta: number) => void
  now: number
}) {
  const { t } = useT()
  const weekdays = t('memberAttendance.calendar.weekdays').split('|')
  const cells = monthGrid(year, month)

  return (
    <View className='rounded-xl border border-border bg-card p-3'>
      <View className='mb-2 flex flex-row items-center justify-between'>
        <View className='px-3 py-1' onClick={() => onMonthChange(-1)}>
          <Text className='text-lg text-primary'>‹</Text>
        </View>
        <Text className='text-sm font-medium text-text'>
          {t('memberAttendance.calendar.monthTitle', { year, month: month + 1 })}
        </Text>
        <View className='px-3 py-1' onClick={() => onMonthChange(1)}>
          <Text className='text-lg text-primary'>›</Text>
        </View>
      </View>

      <View className='flex flex-row flex-wrap'>
        {weekdays.map((label) => (
          <View key={label} style={{ width: CELL_WIDTH }} className='py-1'>
            <Text className='block text-center text-xs text-text-muted'>{label}</Text>
          </View>
        ))}

        {cells.map((dateKey, i) => {
          if (!dateKey) {
            return (
              <View key={`blank-${i}`} style={{ width: CELL_WIDTH }} className='py-1'>
                <View className='h-8' />
              </View>
            )
          }
          const rows = byDate.get(dateKey)
          const tone = rows ? dayTone(rows, now) : null
          // 无需出勤（exempt）与「无排练」同处理：不提供点击/修改入口
          const clickable = !!rows && rows.some((r) => (r.status ?? 'absent') !== 'exempt')
          const selected = dateKey === selectedDate
          return (
            <View
              key={dateKey}
              style={{ width: CELL_WIDTH }}
              className='flex flex-col items-center py-1'
              onClick={clickable ? () => onSelect(dateKey) : undefined}
            >
              <View
                className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  tone ? TONE_BG[tone] : ''
                } ${selected ? 'border-2 border-primary' : ''}`}
              >
                <Text className={`text-xs ${tone ? TONE_TEXT[tone] : 'text-text'}`}>
                  {Number(dateKey.slice(8))}
                </Text>
              </View>
            </View>
          )
        })}
      </View>
    </View>
  )
}
