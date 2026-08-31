import { useMemo } from 'react'
import { View, Text } from '@tarojs/components'
import { useT } from '@/i18n'

type Props = {
  selectedDate: string
  onDateChange: (date: string) => void
}

/** 日期条：今天起 8 天的横向滚轮选择（今天/明天/X日），点击切换选中日 */
export function DateSelector({ selectedDate, onDateChange }: Props) {
  const { t } = useT()
  // 缓存日期列表，避免每次渲染重新计算；todayStr 保证跨天后自动重算
  const todayStr = new Date().toISOString().slice(0, 10)
  const dates = useMemo(() => {
    const dateList: { date: string; label: string; dayOfWeek: string }[] = []
    const today = new Date()
    const weekDays = [
      t('schedule.weekday.sun'),
      t('schedule.weekday.mon'),
      t('schedule.weekday.tue'),
      t('schedule.weekday.wed'),
      t('schedule.weekday.thu'),
      t('schedule.weekday.fri'),
      t('schedule.weekday.sat'),
    ]

    for (let i = 0; i < 8; i++) {
      const date = new Date(today)
      date.setDate(today.getDate() + i)
      // 本地日期格式，避免时区问题
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const dateStr = `${year}-${month}-${day}`

      const label =
        i === 0
          ? t('schedule.today')
          : i === 1
            ? t('schedule.tomorrow')
            : t('schedule.daySuffix', { day: date.getDate() })
      dateList.push({ date: dateStr, label, dayOfWeek: weekDays[date.getDay()] })
    }
    return dateList
    // todayStr 保证跨天后重算日期列表（ESLint 误判为不必要依赖）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, todayStr])

  return (
    <View className='flex gap-2 overflow-x-auto pb-2'>
      {dates.map((item) => {
        const isSelected = item.date === selectedDate
        return (
          <View
            key={item.date}
            className={`flex flex-shrink-0 flex-col items-center rounded-xl px-3 py-2 ${
              isSelected ? 'bg-primary' : 'border border-border bg-card'
            }`}
            onClick={() => onDateChange(item.date)}
          >
            <Text
              className={`text-xs ${isSelected ? 'text-primary-foreground' : 'text-text-muted'}`}
            >
              {item.dayOfWeek}
            </Text>
            <Text
              className={`text-sm font-medium ${isSelected ? 'text-primary-foreground' : 'text-text'}`}
            >
              {item.label}
            </Text>
          </View>
        )
      })}
    </View>
  )
}
