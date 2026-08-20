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
}

export function RehearsalCard({
  item,
  attendance,
  attendanceLoading,
  onSignIn,
  onClick,
  isUpdated,
}: Props) {
  // 签到窗口判定：未开始/已结束不渲染任何按钮
  const blockReason = getSignBlockReason(item.start_time, item.end_time ?? null, new Date())

  // 签到锁定：sign_in_time 非空即已签到，出勤状态固定，不可再签到/修改
  const signedIn = hasSignedIn(attendance?.sign_in_time)

  // 管理员显式设置的非默认状态（出席/迟到/请假，或签到后被改状态）：状态已确定
  const explicitStatus = attendance && attendance.status !== 'absent' ? attendance.status : null

  // 普通签到：无显式状态、未签到、签到窗口内
  const canSign = !signedIn && blockReason === null && explicitStatus === null

  // 签到按钮外显条件：签到窗口内、未签到、考勤已加载
  // （分排/合排都显示；合排无签到码由页面点击时提示，与 Web 端一致）
  const showSignButton = !attendanceLoading && canSign && !!onSignIn

  // 更新提示文案
  const updateLabel = isUpdated ? getUpdateBadgeLabel(item) : null

  return (
    /* 整卡可点击（打开详情弹窗）；签到按钮 stopPropagation 阻断冒泡不触发整卡点击 */
    <Card onClick={onClick}>
      <View className='flex gap-3'>
        {/* 左栏：排练信息（曲目/时间/地点/更新提示 chip） */}
        <View className='min-w-0 flex-1 space-y-0.5 leading-tight'>
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
            <Text className='inline-block rounded bg-warning-bg/80 px-1.5 py-0.5 text-xs text-warning'>
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
              className={`${BUTTON_BASE_CLASS} border border-border bg-surface text-text`}
              onClick={(e) => {
                e.stopPropagation()
                onSignIn?.()
              }}
            >
              签到
            </View>
          </View>
        ) : null}
      </View>
    </Card>
  )
}
