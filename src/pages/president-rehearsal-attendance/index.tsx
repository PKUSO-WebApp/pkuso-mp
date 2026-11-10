import { useMemo, useRef, useState } from 'react'
import { Picker, ScrollView, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useT, useNavTitle } from '@/i18n'
import { usePageRestore } from '@/hooks/usePageRestore'
import { useRehearsalById } from '@/hooks/useRehearsalById'
import { useRehearsalAttendance, type RehearsalAttendanceRow } from '@/hooks/useRehearsalAttendance'
import { useThemeClass } from '@/context/theme-context'
import { usePlaceholderStyle } from '@/hooks/usePlaceholderStyle'
import { PageLoading } from '@/components/ui/PageLoading'
import { Spinner } from '@/components/ui/Spinner'
import { StatusChip } from '@/components/ui/StatusChip'
import { TextField } from '@/components/ui/FormFields'
import { supabase } from '@/lib/supabase'
import {
  ATTENDANCE_EDIT_OPTIONS,
  ATTENDANCE_TONE,
  type AttendanceEditStatus,
} from '@/lib/attendance-calendar'
import { filterByName } from '@/lib/name-search'
import { matchInstrumentSection } from '@/lib/instrument-i18n'
import type { AttendanceStatus } from '@/types/database'
import './index.scss'

function currentStatus(row: RehearsalAttendanceRow): AttendanceStatus {
  return (row.status ?? 'absent') as AttendanceStatus
}

const isEditableStatus = (status: AttendanceStatus): boolean => status !== 'exempt'

/**
 * 团长某场排练的出勤名单（整页，不再是 Modal）。
 *
 * 列表 / 搜索 / 状态编辑与 web 的考勤弹窗同构；搜索复用成员页的
 * `filterByName` + `matchInstrumentSection`。保存直调 `president_update_attendance`。
 */
export default function PresidentRehearsalAttendancePage() {
  const { t } = useT()
  useNavTitle('president.attendance.pageTitle')
  const darkClass = useThemeClass()
  const placeholderStyle = usePlaceholderStyle()
  const cachedId = usePageRestore<string>('id')
  const rehearsalId = Number(cachedId)
  const validId = Number.isFinite(rehearsalId) && rehearsalId > 0 ? rehearsalId : null
  const { rehearsal, status: rehearsalStatus, retry } = useRehearsalById(validId)
  const { rows, loading, failed, reload } = useRehearsalAttendance(
    rehearsal ? rehearsal.id : validId
  )

  const [query, setQuery] = useState('')
  const [edits, setEdits] = useState<Record<string, AttendanceEditStatus>>({})
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const statusLabels = useMemo<Record<AttendanceStatus, string>>(
    () => ({
      present: t('memberAttendance.status.present'),
      late: t('memberAttendance.status.late'),
      absent: t('memberAttendance.status.absent'),
      excused: t('memberAttendance.status.excused'),
      exempt: t('memberAttendance.status.exempt'),
    }),
    [t]
  )

  const optionLabels = ATTENDANCE_EDIT_OPTIONS.map((option) => statusLabels[option])

  const sectionMatch = useMemo(() => matchInstrumentSection(query), [query])
  const filteredRows = useMemo(() => {
    const searchable = rows.map((row) => ({
      id: row.user_id,
      full_name: row.profiles?.full_name ?? null,
      row,
    }))
    const matched = sectionMatch
      ? searchable.filter((item) =>
          sectionMatch.includes((item.row.profiles?.instrument ?? '').trim())
        )
      : filterByName(searchable, query)
    return matched.map((item) => item.row)
  }, [query, rows, sectionMatch])

  const changedRows = useMemo(
    () =>
      rows.filter(
        (row) => edits[row.user_id] !== undefined && edits[row.user_id] !== currentStatus(row)
      ),
    [edits, rows]
  )

  const setEdit = (row: RehearsalAttendanceRow, nextStatus: AttendanceEditStatus) => {
    const current = currentStatus(row)
    setEdits((prev) => {
      const next = { ...prev }
      if (nextStatus === current) delete next[row.user_id]
      else next[row.user_id] = nextStatus
      return next
    })
  }

  const undoEdit = (userId: string) => {
    setEdits((prev) => {
      const next = { ...prev }
      delete next[userId]
      return next
    })
  }

  const mapDirectError = (code: string): string => {
    if (code.includes('exempt_not_editable')) {
      return t('memberAttendance.errors.exemptNotEditable')
    }
    if (code.includes('member_not_found') || code.includes('attendance_missing')) {
      return t('memberAttendance.errors.attendanceMissing')
    }
    return t('president.attendance.saveFailed')
  }

  const handleSave = async () => {
    if (!rehearsal || savingRef.current || changedRows.length === 0) return
    savingRef.current = true
    setSaving(true)
    let ok = 0
    const failedIds = new Set<string>()
    const failedEdits: Record<string, AttendanceEditStatus> = {}
    let firstCode = ''
    try {
      for (const row of changedRows) {
        const nextStatus = edits[row.user_id]
        const { data, error } = await supabase.rpc('president_update_attendance', {
          p_rehearsal_id: rehearsal.id,
          p_user_id: row.user_id,
          p_status: nextStatus,
        })
        const result = data as { ok?: boolean; code?: string } | null
        if (error || !result?.ok) {
          failedIds.add(row.user_id)
          failedEdits[row.user_id] = nextStatus
          firstCode = error?.message ?? result?.code ?? ''
        } else {
          ok += 1
        }
      }
    } finally {
      savingRef.current = false
      setSaving(false)
    }

    if (failedIds.size === 0) {
      setEdits({})
      await reload()
      void Taro.showToast({ title: t('president.attendance.saved'), icon: 'success' })
      return
    }
    await reload()
    setEdits(failedEdits)
    void Taro.showModal({
      title: t('president.attendance.savePartial', {
        ok,
        failed: failedIds.size,
      }),
      content: mapDirectError(firstCode),
      showCancel: false,
    })
  }

  if (rehearsalStatus === 'auth-pending' || rehearsalStatus === 'loading') {
    return <PageLoading darkClass={darkClass} />
  }

  if (!rehearsal) {
    const message =
      rehearsalStatus === 'not-found'
        ? t('president.rehearsal.notFound')
        : t('president.rehearsal.loadFailed')
    return (
      <View className={`${darkClass} flex h-full flex-col bg-page-bg`}>
        <View className='flex flex-1 flex-col items-center justify-center px-6'>
          <Text className='text-sm text-text-muted'>{message}</Text>
          {rehearsalStatus === 'error' || rehearsalStatus === 'auth-error' ? (
            <View
              className='mt-4 rounded-full border border-border bg-surface px-4 py-1.5'
              onClick={retry}
            >
              <Text className='text-xs text-text'>{t('common.actions.retry')}</Text>
            </View>
          ) : null}
        </View>
      </View>
    )
  }

  const rehearsalTitle =
    rehearsal.repertoire || rehearsal.title || t('president.attendance.unnamedRehearsal')

  return (
    <View className={`${darkClass} flex h-full flex-col bg-page-bg`}>
      <ScrollView scrollY className='flex-1 min-h-0'>
        <View className='px-4 pt-3 pb-6'>
          <Text className='mb-3 block text-xs text-text-muted'>
            {t('president.attendance.rehearsalLabel', { title: rehearsalTitle })}
          </Text>

          <TextField
            boxClass='w-full overflow-hidden rounded-xl border border-border bg-muted px-3'
            placeholder={t('president.attendance.searchPlaceholder')}
            value={query}
            onInput={(event) => setQuery(event.detail.value)}
            placeholderStyle={placeholderStyle}
          />

          <View className='mt-2 flex items-center justify-between'>
            <Text className='text-xs text-text-muted'>
              {t('president.attendance.peopleCount', { count: filteredRows.length })}
            </Text>
            {changedRows.length > 0 ? (
              <Text className='text-xs text-primary'>
                {t('president.attendance.changed', { count: changedRows.length })}
              </Text>
            ) : null}
          </View>

          {loading ? (
            <View className='flex justify-center py-8'>
              <Spinner size='sm' />
            </View>
          ) : failed ? (
            <View className='py-6 text-center'>
              <Text className='text-sm text-danger'>
                {t('president.attendance.loadAttendanceFailed')}
              </Text>
              <View className='mt-2' onClick={() => void reload()}>
                <Text className='text-xs text-primary'>{t('president.attendance.retry')}</Text>
              </View>
            </View>
          ) : rows.length === 0 ? (
            <Text className='block py-6 text-center text-sm text-text-muted'>
              {t('president.attendance.emptyAttendance')}
            </Text>
          ) : filteredRows.length === 0 ? (
            <Text className='block py-6 text-center text-sm text-text-muted'>
              {t('president.attendance.noMatch')}
            </Text>
          ) : (
            <View className='mt-2'>
              {filteredRows.map((row) => {
                const current = currentStatus(row)
                const edited = edits[row.user_id]
                const editable = isEditableStatus(current)
                // 默认停在当前状态，避免「打开 picker 直接确认」把 absent 误改成 present；
                // late 不在可编辑集合里，才退回第一项（用户仍需主动选一个）。
                const currentIndex = (ATTENDANCE_EDIT_OPTIONS as readonly string[]).indexOf(current)
                const pickerValue = edited
                  ? ATTENDANCE_EDIT_OPTIONS.indexOf(edited)
                  : currentIndex >= 0
                    ? currentIndex
                    : 0
                return (
                  <View
                    key={row.user_id}
                    className='mb-2 flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2'
                  >
                    <View className='min-w-0 flex-1'>
                      <Text className='block text-sm text-text'>
                        {row.profiles?.full_name || '—'}
                      </Text>
                      <Text className='mt-0.5 block text-xs text-text-muted'>
                        {row.profiles?.instrument || '—'}
                      </Text>
                    </View>
                    {!editable ? (
                      <View className='flex shrink-0 items-center gap-1'>
                        <StatusChip tone='neutral'>{statusLabels[current]}</StatusChip>
                        <Text className='text-[10px] text-text-subtle'>
                          {t('president.attendance.exemptLocked')}
                        </Text>
                      </View>
                    ) : edited ? (
                      <View className='flex shrink-0 items-center gap-2'>
                        <StatusChip tone={ATTENDANCE_TONE[edited]}>
                          {statusLabels[edited]}
                        </StatusChip>
                        <Text
                          className='text-xs text-text-muted'
                          onClick={() => undoEdit(row.user_id)}
                        >
                          {t('president.attendance.cancelEdit')}
                        </Text>
                      </View>
                    ) : (
                      <View className='flex shrink-0 items-center gap-2'>
                        <StatusChip tone={ATTENDANCE_TONE[current]}>
                          {statusLabels[current]}
                        </StatusChip>
                        <Picker
                          mode='selector'
                          range={optionLabels}
                          value={pickerValue}
                          onChange={(event) => {
                            const nextStatus = ATTENDANCE_EDIT_OPTIONS[Number(event.detail.value)]
                            if (nextStatus) setEdit(row, nextStatus)
                          }}
                        >
                          <Text className='text-xs text-primary'>
                            {t('president.attendance.modify')}
                          </Text>
                        </Picker>
                      </View>
                    )}
                  </View>
                )
              })}
            </View>
          )}
        </View>
      </ScrollView>

      <View
        className='border-t border-border bg-surface px-4 pt-3'
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      >
        <View
          className={`rounded-xl py-3 text-center ${
            changedRows.length > 0 && !saving ? 'bg-primary' : 'bg-muted'
          }`}
          onClick={() => void handleSave()}
        >
          <Text
            className={`text-sm font-medium ${
              changedRows.length > 0 && !saving ? 'text-primary-foreground' : 'text-text-muted'
            }`}
          >
            {saving ? t('president.attendance.saving') : t('president.attendance.save')}
          </Text>
        </View>
      </View>
    </View>
  )
}
