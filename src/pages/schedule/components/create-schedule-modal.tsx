import { useRef, useState, useEffect } from 'react'
import { View, Text, Picker } from '@tarojs/components'
import { TextField, PickerField } from '@/components/ui/FormFields'
import Taro from '@tarojs/taro'
import { Modal } from '@/components/ui/Modal'
import { useT } from '@/i18n'
import { ActionBar } from '@/components/ui/ActionBar'

// 时间选择最小单位 15 分钟：分钟列仅提供 00/15/30/45 四档；末尾追加 '24' 以支持 24:00 结束时间。
const HOURS = [
  ...Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')),
  '24',
]
const MINUTES = ['00', '15', '30', '45']

function timeToIndices(time: string): [number, number] {
  if (!time) return [9, 0]
  // 23:59 是 24:00 的内部表示，映射回 picker 的 24 列
  if (time === '23:59') return [HOURS.length - 1, 0]
  if (!/^\d{1,2}:\d{2}$/.test(time)) return [9, 0]
  const [h, m] = time.split(':')
  const hi = HOURS.indexOf(h.padStart(2, '0'))
  const mi = Math.min(MINUTES.length - 1, Math.max(0, Math.round(Number(m) / 15)))
  return [hi < 0 ? 9 : hi, mi]
}

function indicesToTime(indices: number[]): string {
  const hi = indices?.[0] ?? 9
  // 选中 '24' 列时，以 23:59 存储（避免 JS Date 将 hour=24 回绕到 0:00）
  if (hi === HOURS.length - 1) return '23:59'
  const h = HOURS[hi] ?? '09'
  const m = MINUTES[indices?.[1] ?? 0] ?? '00'
  return `${h}:${m}`
}

// 预约日期限制：今天起 7 天（与日程页浏览条一致）
function shiftDays(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
  onCheckConflict: (date: string, startTime: string, endTime: string) => Promise<string | null>
  onClose: () => void
}

/**
 * 添加排练房预约弹窗（Web create-schedule-modal 小程序移植）。
 * 标题 + 日期（Picker）+ 开始/结束时间（multiSelector，分钟列仅 00/15/30/45，最小单位 15 分钟）。
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
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(defaultDate)
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // 仅在打开弹窗时复位表单（defaultDate 随页面选中日更新）。
  // 注意：不能在渲染期依据 date !== defaultDate 复位，否则用户选了非今日日期会被立刻重置回今日。
  useEffect(() => {
    if (open) {
      setTitle('')
      setDate(defaultDate)
      setStartTime('')
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
    if (endTime <= startTime) {
      setError(t('schedule.errors.endAfterStart'))
      return
    }

    submittingRef.current = true
    setIsSubmitting(true)
    setError(null)
    try {
      const conflict = await onCheckConflict(date, startTime, endTime)
      if (conflict) {
        setError(conflict)
        return
      }
      const ok = await onCreate({
        title: trimmedTitle,
        start_time: `${date} ${startTime}:00`,
        end_time: `${date} ${endTime}:00`,
      })
      if (!ok) {
        // hook 已写入具体错误（网络/权限），无则用兜底文案
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
        />

        <PickerField
          className='mt-3'
          label={t('schedule.labels.date')}
          labelClass='block text-label text-text-muted'
        >
          <Picker
            mode='date'
            value={date}
            start={shiftDays(0)}
            end={shiftDays(7)}
            onChange={(e) => setDate(e.detail.value)}
          >
            <Text className='text-xs text-text'>{date}</Text>
          </Picker>
        </PickerField>

        <PickerField
          className='mt-3'
          label={t('schedule.labels.startTime')}
          labelClass='block text-label text-text-muted'
        >
          <Picker
            mode='multiSelector'
            range={[HOURS, MINUTES]}
            value={timeToIndices(startTime)}
            onChange={(e) => {
              setStartTime(indicesToTime(e.detail.value))
              setError(null)
            }}
          >
            <Text className='text-xs text-text'>
              {startTime || t('schedule.placeholders.startTime')}
            </Text>
          </Picker>
        </PickerField>

        <PickerField
          className='mt-3'
          label={t('schedule.labels.endTime')}
          labelClass='block text-label text-text-muted'
        >
          <Picker
            mode='multiSelector'
            range={[HOURS, MINUTES]}
            value={timeToIndices(endTime)}
            onChange={(e) => {
              setEndTime(indicesToTime(e.detail.value))
              setError(null)
            }}
          >
            <Text className='text-xs text-text'>
              {endTime || t('schedule.placeholders.endTime')}
            </Text>
          </Picker>
        </PickerField>

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
