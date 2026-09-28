import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, View, Text, Picker } from '@tarojs/components'
import { useAttendance, type AttendanceHistoryRow } from '@/hooks/useAttendance'
import { ListState } from '@/components/ui/ListState'
import { useT, useNavTitle } from '@/i18n'
import type { TFn } from '@/i18n/core'
import { formatRehearsalRange } from '@/lib/date-utils'
import { isAbsentPlaceholder, getUnsignedLabel } from '@/lib/attendance-utils'
import { STATUS_TEXT_COLOR } from '@/lib/attendance-status'
import { summarizeAttendance, type AttendanceSummaryKey } from '@/lib/attendance-summary'
import type { AttendanceRow } from '@/types/database'
import { useThemeClass } from '@/context/theme-context'
import { useUser } from '@/context/user-context'
import Taro from '@tarojs/taro'
import './index.scss'

const ATTENDANCE_SUMMARY_ITEMS: AttendanceSummaryKey[] = ['present', 'excused', 'absent', 'exempt']

const getAttendanceDisplay = (
  status: AttendanceRow['status'],
  signInTime: string | null,
  startTime: string | null,
  endTime: string | null,
  t: TFn
): { label: string; className: string } => {
  if (!status) return { label: '—', className: 'text-text-muted' }
  if (status === 'absent' && isAbsentPlaceholder(signInTime, startTime, endTime)) {
    return { label: getUnsignedLabel(t), className: 'text-text' }
  }
  return {
    label: t(`profile.attendance.status.${status}` as Parameters<typeof t>[0]) ?? status,
    className: STATUS_TEXT_COLOR[status] ?? '',
  }
}

export default function AttendancePage() {
  const { t } = useT()
  useNavTitle('profile.attendance.title')
  const darkClass = useThemeClass()
  const { user } = useUser()
  const userId = user?.id ?? ''
  const { fetchMyHistory } = useAttendance()
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [rows, setRows] = useState<AttendanceHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [queryFailed, setQueryFailed] = useState(false)
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

  const handleStartChange = (v: string) => {
    setStartDate(v)
    if (v && endDate && v > endDate) return
    void fetchHistory(v, endDate)
  }

  const handleEndChange = (v: string) => {
    setEndDate(v)
    if (startDate && v && startDate > v) return
    void fetchHistory(startDate, v)
  }

  const attendanceSummary = summarizeAttendance(rows)

  const handleCardClick = (rehearsalId: number | null | undefined) => {
    if (!rehearsalId) return
    void Taro.navigateTo({ url: `/pages/rehearsal-detail/index?id=${rehearsalId}` })
  }

  return (
    <View className={`${darkClass} pk-page min-h-screen bg-page-bg`}>
      <ScrollView scrollY className='min-h-0 flex-1'>
        <View className='px-4'>
          <View className='mt-3 flex items-end gap-2'>
            <View className='flex-1'>
              <Text className='mb-1 block text-xs font-medium text-text-muted'>
                {t('profile.attendance.startDate')}
              </Text>
              <Picker
                mode='date'
                value={startDate}
                onChange={(e) => handleStartChange(String(e.detail.value))}
              >
                <View className='flex h-10 items-center rounded-xl border border-border bg-muted px-3'>
                  <Text className='text-sm text-text'>
                    {startDate || t('profile.attendance.unlimited')}
                  </Text>
                </View>
              </Picker>
            </View>
            <Text className='pb-2 text-sm text-text-muted'>{t('profile.attendance.to')}</Text>
            <View className='flex-1'>
              <Text className='mb-1 block text-xs font-medium text-text-muted'>
                {t('profile.attendance.endDate')}
              </Text>
              <Picker
                mode='date'
                value={endDate}
                onChange={(e) => handleEndChange(String(e.detail.value))}
              >
                <View className='flex h-10 items-center rounded-xl border border-border bg-muted px-3'>
                  <Text className='text-sm text-text'>
                    {endDate || t('profile.attendance.unlimited')}
                  </Text>
                </View>
              </Picker>
            </View>
          </View>
          {startDate && endDate && startDate > endDate && (
            <Text className='block text-xs text-danger'>
              {t('profile.attendance.startAfterEnd')}
            </Text>
          )}

          <ScrollView scrollY className='mt-3' style={{ maxHeight: '60vh' }}>
            {/* 切换日期区间时也走 loading 分支（loadingOnlyWhenEmpty=false）：否则会先闪一屏
                旧区间残留的行，再被新区间替换 */}
            <ListState
              loading={loading}
              loadingOnlyWhenEmpty={false}
              error={queryFailed ? t('profile.attendance.loadFailed') : null}
              isEmpty={rows.length === 0}
              emptyText={t('profile.attendance.empty')}
              onRetry={() => void fetchHistory(startDate, endDate)}
            >
              {rows.map((row) => {
                const { label, className } = getAttendanceDisplay(
                  row.status,
                  row.sign_in_time,
                  row.rehearsals?.start_time ?? null,
                  row.rehearsals?.end_time ?? null,
                  t
                )
                return (
                  <View
                    key={row.id}
                    className='mb-0.5 rounded-xl border border-border bg-card p-3'
                    onClick={() => handleCardClick(row.rehearsals?.id)}
                  >
                    <View className='flex items-start justify-between gap-2'>
                      <Text className='min-w-0 flex-1 text-sm font-medium text-text'>
                        {row.rehearsals?.start_time
                          ? formatRehearsalRange(
                              row.rehearsals.start_time,
                              row.rehearsals.end_time ?? null
                            )
                          : t('profile.attendance.timeUnset')}
                      </Text>
                      <Text
                        className={`flex-shrink-0 text-sm font-medium ${className || 'text-text'}`}
                      >
                        {label}
                      </Text>
                    </View>
                    <Text className='mt-1 block text-xs text-text-muted'>
                      {t('profile.attendance.location', {
                        location: row.rehearsals?.location ?? '—',
                      })}
                    </Text>
                    <Text className='mt-1 block text-xs text-text-muted'>
                      {t('profile.attendance.repertoire', {
                        repertoire: row.rehearsals?.repertoire ?? '—',
                      })}
                    </Text>
                  </View>
                )
              })}
            </ListState>
          </ScrollView>
        </View>
      </ScrollView>

      {!loading && !queryFailed && (
        <View
          className='border-t border-border px-4 pt-2'
          style={{ paddingBottom: 'calc(8px + env(safe-area-inset-bottom))' }}
        >
          <Text className='text-xs text-text-muted'>
            {t('profile.attendance.totalRehearsals', { count: attendanceSummary.total })}
            {ATTENDANCE_SUMMARY_ITEMS.map((key) => (
              <Text key={key} className={STATUS_TEXT_COLOR[key]}>
                <Text className='mx-1.5 text-text-muted'>·</Text>
                {`${t(`profile.attendance.status.${key}` as Parameters<typeof t>[0])} ${attendanceSummary[key]}`}
              </Text>
            ))}
          </Text>
        </View>
      )}
    </View>
  )
}
