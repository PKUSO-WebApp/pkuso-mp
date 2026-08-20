import { View, Text } from '@tarojs/components'
import { Modal } from '@/components/ui/Modal'
import { formatRehearsalRange } from '@/lib/date-utils'
import { getSignBlockReason, hasSignedIn } from '@/lib/attendance-utils'
import { STATUS_LABEL, STATUS_TEXT_COLOR } from '@/lib/attendance-status'
import type { RehearsalRow } from '@/types/database'

type AttendanceInfo = {
  status: string
  sign_in_time: string | null
}

type Props = {
  /** 当前查看的排练；null 时弹窗关闭 */
  item: RehearsalRow | null
  /** 当前用户对该排练的出勤记录（未查询到时为 null） */
  attendance?: AttendanceInfo | null
  /** 考勤加载中：出勤状态行显示占位符（防未签到误判） */
  attendanceLoading?: boolean
  onClose: () => void
}

/**
 * 出勤状态展示（Web Issue #173 五行映射的小程序移植）：
 * - 请假（excused）→ 「请假」（无论是否签到，状态已定）
 * - 管理员显式设置的出席/迟到 → 按 STATUS_LABEL 展示
 * - 已签到 → 出勤状态（签到后被改状态的按 STATUS_LABEL 展示）
 * - 未签到 + 已结束 → 「缺勤」
 * - 未签到 + 未开始/进行中 → 「未签到」
 * 渲染期直接求值（不用 useMemo）：getSignBlockReason 内部取 new Date()，
 * 排练跨过结束时刻时依赖不变的 memo 不会重算，「未签到」会停留不更新。
 */
export function getAttendanceDisplay(
  item: RehearsalRow,
  attendance: AttendanceInfo | null | undefined,
  attendanceLoading: boolean
): { label: string; className: string } {
  if (attendanceLoading) {
    return { label: '…', className: '' }
  }
  if (attendance?.status === 'excused') {
    return { label: STATUS_LABEL.excused, className: STATUS_TEXT_COLOR.excused }
  }
  if (attendance?.status === 'present' || attendance?.status === 'late') {
    return {
      label: STATUS_LABEL[attendance.status],
      className: STATUS_TEXT_COLOR[attendance.status],
    }
  }
  if (hasSignedIn(attendance?.sign_in_time)) {
    return {
      label: STATUS_LABEL[attendance?.status ?? ''] ?? STATUS_LABEL.absent,
      className: STATUS_TEXT_COLOR[attendance?.status ?? ''] ?? STATUS_TEXT_COLOR.absent,
    }
  }
  const blockReason = getSignBlockReason(item.start_time, item.end_time ?? null, new Date())
  return blockReason === 'ended'
    ? { label: STATUS_LABEL.absent, className: STATUS_TEXT_COLOR.absent }
    : { label: '未签到', className: '' }
}

/**
 * 排练只读详情弹窗（Web Issue #173 语义，请假入口待请假流程移植后补）：
 * - 左上第一行大字出勤状态（未签到/出席/迟到/缺勤/请假）
 * - 排练信息只读（类型/时间/地点/曲目）
 */
export function RehearsalDetailModal({ item, attendance, attendanceLoading, onClose }: Props) {
  const display = item ? getAttendanceDisplay(item, attendance, !!attendanceLoading) : null

  return (
    <Modal open={!!item} onClose={onClose} title='排练详情' position='bottom'>
      <View className='mt-2 space-y-3'>
        {/* 出勤状态（左上第一行，较大字体；状态色 出席/迟到/缺勤/请假，
            未签到等非状态文案保持默认 text-text） */}
        <Text className={`block text-lg font-semibold ${display?.className || 'text-text'}`}>
          {display?.label}
        </Text>

        {/* 排练信息（只读） */}
        <View className='flex items-start justify-between gap-3'>
          <Text className='shrink-0 text-xs text-text-muted'>排练类型</Text>
          <Text className='text-right text-xs text-text'>
            {item?.type === 'section' ? '分排' : '合排'}
            {item?.type === 'section' && item?.target_section ? ` · ${item.target_section}` : ''}
          </Text>
        </View>
        <View className='flex items-start justify-between gap-3'>
          <Text className='shrink-0 text-xs text-text-muted'>时间</Text>
          <Text className='text-right text-xs text-text'>
            {item?.start_time
              ? formatRehearsalRange(item.start_time, item.end_time ?? null)
              : '时间未设置'}
          </Text>
        </View>
        <View className='flex items-start justify-between gap-3'>
          <Text className='shrink-0 text-xs text-text-muted'>地点</Text>
          <Text className='text-right text-xs text-text'>{item?.location ?? '—'}</Text>
        </View>
        <View className='flex items-start justify-between gap-3'>
          <Text className='shrink-0 text-xs text-text-muted'>曲目</Text>
          <Text className='break-words text-right text-xs text-text'>
            {item?.repertoire ?? '—'}
          </Text>
        </View>
      </View>
    </Modal>
  )
}
