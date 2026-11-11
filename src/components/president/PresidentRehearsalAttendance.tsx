import { useEffect, useMemo, useRef, useState } from 'react'
import { Picker, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useT } from '@/i18n'
import { useRehearsals } from '@/hooks/useRehearsals'
import { usePresidentAttendanceExport } from '@/hooks/usePresidentAttendanceExport'
import { ListState } from '@/components/ui/ListState'
import { formatRehearsalDateTimeLine, filterRehearsalsByDateRange } from '@/lib/attendance-export'
import { getLocalDateString } from '@/lib/date-utils'
import { tAppError } from '@/lib/appError'
import type { RehearsalRow } from '@/types/database'

type Props = {
  /** attendance：点排练卡片可进考勤编辑页 */
  canEdit: boolean
  /** attendance_export：显示勾选与转发 */
  canExport: boolean
}

/**
 * 团长的「排练考勤」tab（替换团长的「我的声部」）。
 *
 * 布局对齐 web 的 admin/members「排练考勤」视图：日期区间筛选 → 勾选排练 →
 * 转发选中考勤；点排练卡片进入出勤名单页。
 *
 * 导出走「转发到微信」。微信要求 `shareFileMessage` 在点击的同步栈里调用，所以
 * 选中的 xlsx 由 hook 提前写本地，点击只做同步分享。
 */
export function PresidentRehearsalAttendance({ canEdit, canExport }: Props) {
  const { t } = useT()
  const { data, loading, error, fetch } = useRehearsals()
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
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

  // 日期筛选变化后，去掉不在当前列表里的选中项（不导出看不见的排练）
  useEffect(() => {
    const visible = new Set(filtered.map((rehearsal) => rehearsal.id))
    setSelectedIds((prev) => {
      let changed = false
      const next = new Set<number>()
      for (const id of prev) {
        if (visible.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [filtered])

  const selectedIdList = useMemo(() => [...selectedIds].sort((a, b) => a - b), [selectedIds])

  const { state, prepare, shareSelected } = usePresidentAttendanceExport({
    enabled: canExport,
    startDate,
    endDate,
    rehearsals: filtered,
    selectedIds: selectedIdList,
    refreshKey,
  })

  const today = getLocalDateString()
  const hasFilter = !!startDate || !!endDate
  const allSelected =
    filtered.length > 0 && filtered.every((rehearsal) => selectedIds.has(rehearsal.id))
  const canShare = state.status === 'ready' && !!state.file && selectedIdList.length > 0

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(filtered.map((rehearsal) => rehearsal.id)))
  }

  const shareButtonLabel = () => {
    if (state.status === 'error') return t('president.attendance.exportSelectedRetry')
    if (state.status === 'preparing' || state.status === 'idle') {
      return t('president.attendance.exportSelectedPreparing')
    }
    if (selectedIdList.length === 0) return t('president.attendance.selectRehearsalFirst')
    if (!state.file) return t('president.attendance.noRecords')
    return t('president.attendance.exportSelected', { count: selectedIdList.length })
  }

  const handleShare = () => {
    if (state.status === 'error') {
      // 准备失败时点一下重试（不是转发，不受手势约束）
      void prepare()
      return
    }
    if (state.status !== 'ready') return
    const result = shareSelected()
    if (result === 'empty') {
      void Taro.showToast({
        title: t('president.attendance.selectRehearsalFirst'),
        icon: 'none',
      })
    } else if (result === 'noRecords') {
      void Taro.showToast({ title: t('president.attendance.noRecords'), icon: 'none' })
    } else if (result === 'preparing') {
      void Taro.showToast({
        title: t('president.attendance.exportSelectedPreparing'),
        icon: 'none',
      })
    } else if (result === 'error') {
      void Taro.showToast({ title: t('president.attendance.shareFailed'), icon: 'none' })
    }
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
        <View className='mt-3 flex items-center gap-2'>
          <View
            className='shrink-0 rounded-full border border-border bg-surface px-4 py-3'
            onClick={toggleSelectAll}
          >
            <Text className='text-xs font-medium text-text'>
              {allSelected
                ? t('president.attendance.deselectAll')
                : t('president.attendance.selectAll')}
            </Text>
          </View>
          <View
            className={`flex-1 rounded-2xl px-4 py-3 text-center ${
              canShare ? 'bg-primary' : 'bg-muted'
            }`}
            onClick={handleShare}
          >
            <Text
              className={`text-sm font-medium ${
                canShare ? 'text-primary-foreground' : 'text-text-muted'
              }`}
            >
              {shareButtonLabel()}
            </Text>
          </View>
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
            const selected = selectedIds.has(rehearsal.id)
            return (
              <View key={rehearsal.id} className='mb-2 flex items-center gap-2'>
                {canExport ? (
                  <View
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      selected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-surface'
                    }`}
                    onClick={() => toggleSelected(rehearsal.id)}
                  >
                    <Text className='text-[10px]'>{selected ? '✓' : ''}</Text>
                  </View>
                ) : null}
                <View
                  className='min-w-0 flex-1 rounded-2xl border border-border bg-card px-3 py-2.5'
                  onClick={() => {
                    if (!canEdit) return
                    void Taro.navigateTo({
                      url: `/pages/president-rehearsal-attendance/index?id=${rehearsal.id}`,
                    })
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
              </View>
            )
          })}
        </ListState>
      </View>
    </View>
  )
}
