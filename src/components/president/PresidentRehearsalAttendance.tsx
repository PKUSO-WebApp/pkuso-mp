import { useMemo, useRef, useState } from 'react'
import { Picker, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useT } from '@/i18n'
import { useRehearsals } from '@/hooks/useRehearsals'
import {
  usePresidentAttendanceExport,
  type AttendanceExportFile,
} from '@/hooks/usePresidentAttendanceExport'
import { ListState } from '@/components/ui/ListState'
import { AttendanceEditModal } from '@/components/president/AttendanceEditModal'
import { formatRehearsalDateTimeLine, filterRehearsalsByDateRange } from '@/lib/attendance-export'
import { getLocalDateString } from '@/lib/date-utils'
import { tAppError } from '@/lib/appError'
import type { RehearsalRow } from '@/types/database'

type Props = {
  /** attendance：点排练卡片可编辑 */
  canEdit: boolean
  /** attendance_export：显示转发按钮 */
  canExport: boolean
}

/**
 * 团长的「排练考勤」tab（替换团长的「我的声部」）。
 *
 * 布局对齐 web 的 admin/members「排练考勤」视图：
 * 日期区间筛选 → 导出区间全部 → 排练卡片（点开编辑 / 单场导出）。
 * 导出走「转发到微信」，文件在进入 tab / 改筛选后**提前备好**，
 * 点击时同步调 `shareFileMessage`（微信要求用户点击的同步栈，见 hook 注释）。
 */
export function PresidentRehearsalAttendance({ canEdit, canExport }: Props) {
  const { t } = useT()
  const { data, loading, error, fetch } = useRehearsals()
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [editing, setEditing] = useState<RehearsalRow | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const firstShowRef = useRef(true)

  useDidShow(() => {
    if (firstShowRef.current) {
      firstShowRef.current = false
      return
    }
    void fetch({ silent: true })
    setRefreshKey((key) => key + 1)
  })

  const filtered = useMemo(
    () => filterRehearsalsByDateRange(data, startDate, endDate),
    [data, startDate, endDate]
  )

  const { prepared, prepare, shareFile } = usePresidentAttendanceExport({
    enabled: canExport,
    startDate,
    endDate,
    rehearsals: filtered,
    refreshKey,
  })

  const today = getLocalDateString()
  const hasFilter = !!startDate || !!endDate

  const showNoRecords = () => {
    void Taro.showToast({ title: t('president.attendance.noRecords'), icon: 'none' })
  }

  const sharePrepared = (file: AttendanceExportFile | null | undefined) => {
    if (!file) {
      showNoRecords()
      return
    }
    // 必须同步调用，不能在前面 await
    shareFile(file)
  }

  const exportAllReady = prepared.status === 'ready' && !!prepared.all

  const exportAllLabel = () => {
    if (prepared.status === 'preparing') return t('president.attendance.exportAllPreparing')
    if (prepared.status === 'error') return t('president.attendance.exportAllRetry')
    if (prepared.status === 'ready' && !prepared.all && filtered.length > 0) {
      return t('president.attendance.noRecords')
    }
    return t('president.attendance.exportAll', { count: filtered.length })
  }

  const rehearsalTitle = (rehearsal: RehearsalRow) =>
    rehearsal.repertoire || rehearsal.title || t('president.attendance.unnamedRehearsal')

  return (
    <View className='px-4 pt-3 pb-6'>
      <View className='flex items-end gap-2'>
        <View className='flex-1'>
          <Text className='mb-1 block text-xs font-medium text-text-muted'>
            {t('president.attendance.startDate')}
          </Text>
          <Picker
            mode='date'
            value={startDate || today}
            end={endDate || undefined}
            onChange={(event) => setStartDate(String(event.detail.value))}
          >
            <View className='flex h-[var(--size-control-h)] items-center justify-between rounded-xl border border-border bg-muted px-3'>
              <Text className='text-sm text-text'>
                {startDate || t('president.attendance.unlimited')}
              </Text>
              <Text className='ml-2 shrink-0 text-sm text-text-muted'>▾</Text>
            </View>
          </Picker>
        </View>
        <View className='flex-1'>
          <Text className='mb-1 block text-xs font-medium text-text-muted'>
            {t('president.attendance.endDate')}
          </Text>
          <Picker
            mode='date'
            value={endDate || today}
            start={startDate || undefined}
            onChange={(event) => setEndDate(String(event.detail.value))}
          >
            <View className='flex h-[var(--size-control-h)] items-center justify-between rounded-xl border border-border bg-muted px-3'>
              <Text className='text-sm text-text'>
                {endDate || t('president.attendance.unlimited')}
              </Text>
              <Text className='ml-2 shrink-0 text-sm text-text-muted'>▾</Text>
            </View>
          </Picker>
        </View>
      </View>

      {hasFilter ? (
        <View
          className='mt-2 self-start'
          onClick={() => {
            setStartDate('')
            setEndDate('')
          }}
        >
          <Text className='text-xs text-primary'>{t('president.attendance.clearFilter')}</Text>
        </View>
      ) : null}

      {canExport ? (
        <View
          className={`mt-3 rounded-2xl px-4 py-3 text-center ${
            exportAllReady ? 'bg-primary' : 'bg-muted'
          }`}
          onClick={() => {
            if (prepared.status === 'error') {
              // 准备失败时点一下重试（这不是转发，不需要手势约束）
              void prepare()
              return
            }
            if (prepared.status !== 'ready') return
            sharePrepared(prepared.all)
          }}
        >
          <Text
            className={`text-sm font-medium ${
              exportAllReady ? 'text-primary-foreground' : 'text-text-muted'
            }`}
          >
            {exportAllLabel()}
          </Text>
        </View>
      ) : null}

      <View className='mt-3'>
        <ListState
          loading={loading}
          isEmpty={filtered.length === 0}
          emptyText={t('president.attendance.empty')}
          error={tAppError(t, error)}
          onRetry={() => void fetch()}
        >
          {filtered.map((rehearsal) => {
            const file = prepared.perRehearsal[rehearsal.id]
            const exportLabel =
              prepared.status === 'error'
                ? t('president.attendance.retry')
                : prepared.status === 'preparing' || prepared.status === 'idle'
                  ? t('president.attendance.preparing')
                  : file
                    ? t('president.attendance.exportOne')
                    : t('president.attendance.noRecords')
            const canShare = prepared.status === 'ready' && !!file
            return (
              <View key={rehearsal.id} className='mb-2 flex items-center gap-2'>
                <View
                  className='min-w-0 flex-1 rounded-2xl border border-border bg-card px-3 py-2.5'
                  onClick={() => {
                    if (canEdit) setEditing(rehearsal)
                  }}
                >
                  <Text className='block truncate text-sm font-medium text-text'>
                    {rehearsalTitle(rehearsal)}
                  </Text>
                  <Text className='mt-1 block text-xs text-text-muted'>
                    {formatRehearsalDateTimeLine(rehearsal.start_time, rehearsal.end_time)}
                  </Text>
                  <Text className='mt-0.5 block text-xs text-text-muted'>
                    📍 {rehearsal.location || '—'}
                  </Text>
                </View>
                {canExport ? (
                  <View
                    className={`shrink-0 rounded-full px-3 py-1.5 ${
                      canShare ? 'bg-primary' : 'bg-muted'
                    }`}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (prepared.status === 'error') {
                        void prepare()
                        return
                      }
                      if (prepared.status !== 'ready') return
                      sharePrepared(file)
                    }}
                  >
                    <Text
                      className={`text-xs font-medium ${
                        canShare ? 'text-primary-foreground' : 'text-text-muted'
                      }`}
                    >
                      {exportLabel}
                    </Text>
                  </View>
                ) : null}
              </View>
            )
          })}
        </ListState>
      </View>

      <AttendanceEditModal
        open={!!editing}
        rehearsal={editing}
        onClose={() => setEditing(null)}
        onSaved={() => setRefreshKey((key) => key + 1)}
      />
    </View>
  )
}
