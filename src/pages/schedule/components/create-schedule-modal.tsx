import { useRef, useState } from 'react'
import { View, Text, Input, Picker } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Modal } from '@/components/ui/Modal'

// 时间选择最小单位 15 分钟：分钟列仅提供 00/15/30/45 四档。
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '15', '30', '45']

function timeToIndices(time: string): [number, number] {
  if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return [9, 0]
  const [h, m] = time.split(':')
  const hi = HOURS.indexOf(h.padStart(2, '0'))
  const mi = Math.min(MINUTES.length - 1, Math.max(0, Math.round(Number(m) / 15)))
  return [hi < 0 ? 9 : hi, mi]
}

function indicesToTime(indices: number[]): string {
  const h = HOURS[indices?.[0] ?? 9] ?? '09'
  const m = MINUTES[indices?.[1] ?? 0] ?? '00'
  return `${h}:${m}`
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
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(defaultDate)
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // 切换打开时复位表单（defaultDate 随页面选中日更新）
  if (open && date !== defaultDate && !isSubmitting) {
    setDate(defaultDate)
  }

  const handleClose = () => {
    if (isSubmitting) return
    setError(null)
    onClose()
  }

  const handleSubmit = async () => {
    if (submittingRef.current || isSubmitting) return
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError('请填写预约标题')
      return
    }
    if (!startTime) {
      setError('请选择开始时间')
      return
    }
    if (!endTime) {
      setError('请选择结束时间')
      return
    }
    if (endTime <= startTime) {
      setError('结束时间必须晚于开始时间')
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
        setError('添加失败，请重试')
        return
      }
      void Taro.showToast({ title: '预约已添加', icon: 'success' })
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
      title='添加预约'
      position='bottom'
      closeOnOverlay={!busy}
    >
      <View className='mt-2 space-y-3'>
        <View className='space-y-1'>
          <Text className='block text-label text-text-muted'>预约标题</Text>
          <View className='w-full overflow-hidden rounded-xl border border-border bg-muted px-3'>
            <Input
              value={title}
              onInput={(e) => {
                setTitle(e.detail.value)
                setError(null)
              }}
              disabled={busy}
              className='bg-transparent py-2 text-xs text-text'
              placeholder='如：排练房A预约'
            />
          </View>
        </View>

        <View className='space-y-1'>
          <Text className='block text-label text-text-muted'>预约日期</Text>
          <View className='rounded-xl border border-border bg-muted px-3 py-2'>
            <Picker mode='date' value={date} onChange={(e) => setDate(e.detail.value)}>
              <Text className='text-xs text-text'>{date}</Text>
            </Picker>
          </View>
        </View>

        <View className='space-y-1'>
          <Text className='block text-label text-text-muted'>开始时间</Text>
          <View className='rounded-xl border border-border bg-muted px-3 py-2'>
            <Picker
              mode='multiSelector'
              range={[HOURS, MINUTES]}
              value={timeToIndices(startTime)}
              onChange={(e) => {
                setStartTime(indicesToTime(e.detail.value))
                setError(null)
              }}
            >
              <Text className='text-xs text-text'>{startTime || '请选择开始时间'}</Text>
            </Picker>
          </View>
        </View>

        <View className='space-y-1'>
          <Text className='block text-label text-text-muted'>结束时间</Text>
          <View className='rounded-xl border border-border bg-muted px-3 py-2'>
            <Picker
              mode='multiSelector'
              range={[HOURS, MINUTES]}
              value={timeToIndices(endTime)}
              onChange={(e) => {
                setEndTime(indicesToTime(e.detail.value))
                setError(null)
              }}
            >
              <Text className='text-xs text-text'>{endTime || '请选择结束时间'}</Text>
            </Picker>
          </View>
        </View>

        {error && <Text className='block text-sm text-danger'>{error}</Text>}

        <View className='flex items-center justify-end gap-2 pt-1'>
          <View
            className='rounded-full px-4 py-1.5 text-label text-text-muted'
            onClick={busy ? undefined : () => handleClose()}
          >
            取消
          </View>
          <View
            className={`rounded-full bg-primary px-4 py-1.5 text-label font-medium text-primary-foreground ${busy ? 'opacity-60' : ''}`}
            onClick={busy ? undefined : () => void handleSubmit()}
          >
            {isSubmitting ? '添加中…' : '确定'}
          </View>
        </View>
      </View>
    </Modal>
  )
}
