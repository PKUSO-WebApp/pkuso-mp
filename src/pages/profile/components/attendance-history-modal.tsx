import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, View, Text, Picker } from '@tarojs/components'
import { useAttendance, type AttendanceHistoryRow } from '@/hooks/useAttendance'
import { Modal } from '@/components/ui/Modal'
import { formatRehearsalRange } from '@/lib/date-utils'
import { isAbsentPlaceholder, UNSIGNED_LABEL } from '@/lib/attendance-utils'
import { STATUS_LABEL, STATUS_TEXT_COLOR } from '@/lib/attendance-status'
import { summarizeAttendance, type AttendanceSummaryKey } from '@/lib/attendance-summary'
import type { AttendanceRow } from '@/types/database'

// 统计栏目顺序（只声明 key 顺序）：文案取 STATUS_LABEL、颜色取 STATUS_TEXT_COLOR，
// 均从 attendance-status 派生（单一事实源）；「未签到/未评定」不参与分类
const ATTENDANCE_SUMMARY_ITEMS: AttendanceSummaryKey[] = ['present', 'late', 'excused', 'absent']

/**
 * 考勤状态展示（与 Web 端 profile 考勤弹窗同源语义）：
 * - present/late/excused：直接按 STATUS_LABEL 映射；
 * - absent：新建排练时为全员预生成的默认占位（未签到）——排练未结束时
 *   不构成缺勤，显示「未签到」；已结束（或已签到补签）才确认缺勤；
 * - status 为 null（历史数据/未评定）：显示「—」。
 */
const getAttendanceDisplay = (
  status: AttendanceRow['status'],
  signInTime: string | null,
  startTime: string | null,
  endTime: string | null
): { label: string; className: string } => {
  if (!status) return { label: '—', className: 'text-text-muted' }
  if (status === 'absent' && isAbsentPlaceholder(signInTime, startTime, endTime)) {
    return { label: UNSIGNED_LABEL, className: 'text-text' }
  }
  return {
    label: STATUS_LABEL[status] ?? status,
    className: STATUS_TEXT_COLOR[status] ?? '',
  }
}

type Props = {
  /** 查询对象（当前登录用户）id，由父级在 user 就绪后挂载本组件 */
  userId: string
  onClose: () => void
}

/**
 * 我的考勤弹窗：起止日期过滤本人考勤列表（join 排练展示信息）。
 * 状态机：挂载即查询全部；起 > 止 时提示且不查询（保留上次结果，不清空已选日期）；
 * 竞态守卫用递增序号：快速切换区间时丢弃过期响应。
 * 父级条件渲染挂载：打开时查询、关闭即卸载清态（重开默认查全部）。
 */
export function AttendanceHistoryModal({ userId, onClose }: Props) {
  const { fetchMyHistory } = useAttendance()
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [rows, setRows] = useState<AttendanceHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [queryFailed, setQueryFailed] = useState(false) // 查询失败态（显示「加载失败」）
  const seqRef = useRef(0)

  const fetchHistory = useCallback(
    async (start: string, end: string) => {
      setLoading(true)
      setQueryFailed(false)
      const seq = ++seqRef.current
      const { rows: data, error } = await fetchMyHistory(userId, {
        startDate: start,
        endDate: end,
      })
      // 仅最新一次查询的响应生效（用户可能已快速切换区间）
      if (seq !== seqRef.current) return
      setLoading(false)
      if (error) {
        setQueryFailed(true)
        setRows([])
        return
      }
      setRows(data)
    },
    [fetchMyHistory, userId]
  )

  useEffect(() => {
    void fetchHistory('', '')
  }, [fetchHistory])

  /** 开始日期变更：起 > 止 时仅提示不查询（保留上次结果，不清空已选），否则按新区间查询 */
  const handleStartChange = (v: string) => {
    setStartDate(v)
    if (v && endDate && v > endDate) return
    void fetchHistory(v, endDate)
  }

  /** 结束日期变更：同上（起 > 止 时提示不查询） */
  const handleEndChange = (v: string) => {
    setEndDate(v)
    if (startDate && v && startDate > v) return
    void fetchHistory(startDate, v)
  }

  // 区间统计：与列表同源派生（不额外查询），渲染期直接求值（不用 useMemo）——
  // 占位判定依赖实时时钟 now，缓存旧 now 会在排练跨过结束时刻后出现
  // 列表翻转为「缺勤」而统计仍按旧时刻计占位的同屏矛盾
  const attendanceSummary = summarizeAttendance(rows)

  return (
    <Modal open onClose={onClose} title='我的考勤' position='bottom'>
      <View className='mt-4 space-y-3'>
        <View className='flex items-end gap-2'>
          <View className='flex-1'>
            <Text className='mb-1 block text-xs font-medium text-text-muted'>开始日期</Text>
            <Picker
              mode='date'
              value={startDate}
              onChange={(e) => handleStartChange(String(e.detail.value))}
            >
              <View className='flex h-10 items-center rounded-xl border border-border bg-muted px-3'>
                <Text className='text-sm text-text'>{startDate || '不限'}</Text>
              </View>
            </Picker>
          </View>
          <Text className='pb-2 text-sm text-text-muted'>至</Text>
          <View className='flex-1'>
            <Text className='mb-1 block text-xs font-medium text-text-muted'>结束日期</Text>
            <Picker
              mode='date'
              value={endDate}
              onChange={(e) => handleEndChange(String(e.detail.value))}
            >
              <View className='flex h-10 items-center rounded-xl border border-border bg-muted px-3'>
                <Text className='text-sm text-text'>{endDate || '不限'}</Text>
              </View>
            </Picker>
          </View>
        </View>
        {startDate && endDate && startDate > endDate && (
          <Text className='block text-xs text-danger'>开始日期不能晚于结束日期</Text>
        )}

        {/* 考勤列表：罗列内容可滚动（max-h 容器，改用原生 ScrollView 以兼容真机） */}
        <ScrollView scrollY style={{ maxHeight: '60vh' }}>
          {loading ? (
            <Text className='block py-6 text-center text-xs text-text-muted'>加载中…</Text>
          ) : queryFailed ? (
            <Text className='block py-6 text-center text-sm text-text-muted'>
              加载失败，请稍后重试
            </Text>
          ) : rows.length === 0 ? (
            <Text className='block py-6 text-center text-sm text-text-muted'>
              该区间暂无考勤记录
            </Text>
          ) : (
            rows.map((row) => {
              const { label, className } = getAttendanceDisplay(
                row.status,
                row.sign_in_time,
                row.rehearsals?.start_time ?? null,
                row.rehearsals?.end_time ?? null
              )
              return (
                <View key={row.id} className='rounded-xl border border-border bg-card p-3 mb-0.5'>
                  <View className='flex items-start justify-between gap-2'>
                    <Text className='min-w-0 flex-1 text-sm font-medium text-text'>
                      {row.rehearsals?.start_time
                        ? formatRehearsalRange(
                            row.rehearsals.start_time,
                            row.rehearsals.end_time ?? null
                          )
                        : '时间未设置'}
                    </Text>
                    <Text
                      className={`flex-shrink-0 text-sm font-medium ${className || 'text-text'}`}
                    >
                      {label}
                    </Text>
                  </View>
                  <Text className='mt-1 block text-xs text-text-muted'>
                    地点：{row.rehearsals?.location ?? '—'}
                  </Text>
                  <Text className='mt-1 block text-xs text-text-muted'>
                    曲目：{row.rehearsals?.repertoire ?? '—'}
                  </Text>
                </View>
              )
            })
          )}
        </ScrollView>

        {/* 区间统计：固定于列表滚动容器下方；加载中/失败时隐藏（数据未就绪不展示可能误导的统计） */}
        {!loading && !queryFailed && (
          <View className='border-t border-border pt-2'>
            <Text className='text-xs text-text-muted'>
              {`共 ${attendanceSummary.total} 次排练`}
              {ATTENDANCE_SUMMARY_ITEMS.map((key) => (
                <Text key={key} className={STATUS_TEXT_COLOR[key]}>
                  <Text className='mx-1.5 text-text-muted'>·</Text>
                  {`${STATUS_LABEL[key]} ${attendanceSummary[key]}`}
                </Text>
              ))}
            </Text>
          </View>
        )}
      </View>
    </Modal>
  )
}
