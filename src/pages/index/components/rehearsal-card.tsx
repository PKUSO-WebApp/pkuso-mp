import { View, Text } from '@tarojs/components'
import { Card } from '@/components/ui/Card'
import { formatRehearsalRange } from '@/lib/date-utils'
import { getSignBlockReason, hasSignedIn } from '@/lib/attendance-utils'
import { getUpdateBadgeLabel } from '@/lib/rehearsal-sort'
import type { RehearsalRow } from '@/types/database'

/** 右栏签到按钮基础样式：等高 h-8、w-full、文字居中 */
const BUTTON_BASE_CLASS =
  'inline-flex items-center justify-center h-8 w-full rounded-full px-3 text-center text-xs font-medium'

type AttendanceInfo = {
  status: string
  sign_in_time: string | null
}

type Props = {
  item: RehearsalRow
  /** 当前用户对该排练的出勤记录（未查询到时为 null） */
  attendance?: AttendanceInfo | null
  /** 考勤数据加载中：不渲染签到按钮，防首屏 map 未就绪时闪错 */
  attendanceLoading?: boolean
  onSignIn?: () => void
  /** 整卡点击打开详情弹窗（Web Issue #173 语义） */
  onClick?: () => void
  /** 编辑过（updated_at > created_at），在标题下方展示「更新」提示 */
  isUpdated?: boolean
  /** 该排练当前有效（未撤回/未取消）的请假申请；无则 null（Issue #142，供覆盖请假按钮判定） */
  leaveRequest?: { status: string } | null
}

export function RehearsalCard({
  item,
  attendance,
  attendanceLoading,
  onSignIn,
  onClick,
  isUpdated,
  leaveRequest,
}: Props) {
  // 签到窗口判定：未开始/已结束不渲染任何按钮
  const blockReason = getSignBlockReason(item.start_time, item.end_time ?? null, new Date())

  // 签到锁定：sign_in_time 非空即已签到，出勤状态固定，不可再签到/修改
  const signedIn = hasSignedIn(attendance?.sign_in_time)

  // 管理员显式设置的非默认状态（出席/迟到/请假，或签到后被改状态）：状态已确定；
  // 其中「请假未签到且无有效申请」仍可签到覆盖（见 canSignOverrideExcused，Issue #159 返工）
  const explicitStatus = attendance && attendance.status !== 'absent' ? attendance.status : null

  // 进行中申请（待审批/已通过）：拦截普通签到，需黄色「覆盖请假」按钮；已驳回/已撤回/已取消视同无申请
  const leaveStatus = leaveRequest?.status ?? null
  const hasActiveLeaveRequest = leaveStatus === 'pending' || leaveStatus === 'approved'

  // 覆盖请假（Issue #155）：签到窗口内且存在 pending/approved 申请时，按钮变黄色「覆盖请假」
  const canOverrideLeave = !signedIn && blockReason === null && hasActiveLeaveRequest

  // 覆盖签到（Issue #159 返工）：出勤为请假（excused）未签到、且无进行中申请时，
  // 签到窗口内仍显示普通「签到」按钮——到场可签覆盖请假状态，修复撤回已通过申请后的死局
  const canSignOverrideExcused =
    explicitStatus === 'excused' && !signedIn && !hasActiveLeaveRequest && blockReason === null

  // 普通签到：无显式状态、未签到、签到窗口内
  const canSign = !signedIn && blockReason === null && explicitStatus === null

  // 签到按钮外显条件：签到窗口内、未签到、考勤已加载
  // （普通签到、黄色覆盖请假、excused 覆盖签到 三种情况渲染按钮）
  const showSignButton =
    !attendanceLoading && (canSign || canOverrideLeave || canSignOverrideExcused) && !!onSignIn

  // 更新提示文案
  const updateLabel = isUpdated ? getUpdateBadgeLabel(item) : null

  return (
    /* 整卡可点击（打开详情弹窗）；签到按钮 stopPropagation 阻断冒泡不触发整卡点击 */
    <Card onClick={onClick}>
      <View className='flex gap-3'>
        {/* 左栏：排练信息（曲目/时间/地点/更新提示 chip） */}
        <View className='min-w-0 flex-1 space-y-1 leading-tight'>
          <Text className='block truncate text-sm text-text-muted'>
            {item.repertoire || '排练'}
            {item.type === 'section' && item.target_section ? ` · ${item.target_section}` : ''}
          </Text>
          <Text className='block text-base font-semibold text-text'>
            {item.start_time
              ? formatRehearsalRange(item.start_time, item.end_time ?? null)
              : '时间未设置'}
          </Text>
          {updateLabel && (
            <Text className='inline-block rounded bg-warning-bg/80 px-1.5 py-1 text-xs text-warning'>
              {updateLabel}
            </Text>
          )}
          <Text className='block text-xs text-text-muted'>
            地点：{item.location || '未定'}
            {item.type === 'section' && item.target_section
              ? ` · 针对：${item.target_section}`
              : ''}
          </Text>
        </View>

        {/* 右栏：签到按钮 */}
        {attendanceLoading ? (
          <View className='flex w-32 flex-shrink-0 flex-col gap-2 border-l border-border pl-3'>
            <View className='inline-flex h-8 w-full items-center justify-center rounded-full bg-muted px-3 text-center text-xs text-text-subtle'>
              …
            </View>
          </View>
        ) : showSignButton ? (
          <View className='flex w-32 flex-shrink-0 flex-col gap-2 border-l border-border pl-3'>
            <View
              className={`${BUTTON_BASE_CLASS} ${
                canOverrideLeave
                  ? 'bg-warning-bg text-warning'
                  : 'border border-border bg-surface text-text'
              }`}
              onClick={(e) => {
                e.stopPropagation()
                onSignIn?.()
              }}
            >
              {canOverrideLeave ? '覆盖请假' : '签到'}
            </View>
          </View>
        ) : null}
      </View>
    </Card>
  )
}
