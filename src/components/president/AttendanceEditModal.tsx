import { useMemo, useRef, useState } from 'react'
import { Picker, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Modal } from '@/components/ui/Modal'
import { TextField } from '@/components/ui/FormFields'
import { Spinner } from '@/components/ui/Spinner'
import { useT } from '@/i18n'
import { usePlaceholderStyle } from '@/hooks/usePlaceholderStyle'
import { useRehearsalAttendance, type RehearsalAttendanceRow } from '@/hooks/useRehearsalAttendance'
import { supabase } from '@/lib/supabase'
import {
  ATTENDANCE_EDIT_OPTIONS,
  ATTENDANCE_TONE,
  type AttendanceEditStatus,
} from '@/lib/attendance-calendar'
import { filterByName } from '@/lib/name-search'
import { matchInstrumentSection } from '@/lib/instrument-i18n'
import { StatusChip } from '@/components/ui/StatusChip'
import type { AttendanceStatus, RehearsalRow } from '@/types/database'

type Props = {
  open: boolean
  rehearsal: RehearsalRow | null
  onClose: () => void
  /** 保存成功后通知父组件：重新准备导出文件 */
  onSaved: () => void
}

function currentStatus(row: RehearsalAttendanceRow): AttendanceStatus {
  return (row.status ?? 'absent') as AttendanceStatus
}

const isEditableStatus = (status: AttendanceStatus): boolean => status !== 'exempt'

/**
 * 团长在「排练考勤」里编辑某场考勤的弹窗。
 *
 * 与 web 的考勤弹窗同构：列出该场全部成员 + 当前状态，改完点保存。
 * 差异（用户 2026-11-11 指定）：
 * - 支持按姓名 / 声部搜索，搜索规则完全复用成员页（filterByName + matchInstrumentSection）；
 * - 小程序没有原生 select，改成「当前状态 + 修改」的 Picker，避免一行塞一个下拉框。
 *
 * 写库走 `president_update_attendance`（attendance 能力），只接受 present/absent/excused；
 * exempt 行不可改（后端也会拒）。
 */
export function AttendanceEditModal({ open, rehearsal, onClose, onSaved }: Props) {
  const { t } = useT()
  const placeholderStyle = usePlaceholderStyle()
  const rehearsalId = open ? (rehearsal?.id ?? null) : null
  const { rows, loading, failed, reload } = useRehearsalAttendance(rehearsalId)

  const [query, setQuery] = useState('')
  const [edits, setEdits] = useState<Record<string, AttendanceEditStatus>>({})
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  // 换场 / 关闭时重置搜索与未保存修改。用渲染期重置（与 web 的 AttendanceModal 同款），
  // 不用 effect：effect 里 setState 会多一帧显示上一场的编辑。
  const stateKey = open ? String(rehearsal?.id ?? '') : null
  const [prevStateKey, setPrevStateKey] = useState<string | null>(stateKey)
  if (prevStateKey !== stateKey) {
    setPrevStateKey(stateKey)
    setQuery('')
    setEdits({})
  }

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

  const optionLabels = ATTENDANCE_EDIT_OPTIONS.map((status) => statusLabels[status])

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

  const setEdit = (row: RehearsalAttendanceRow, status: AttendanceEditStatus) => {
    const current = currentStatus(row)
    setEdits((prev) => {
      const next = { ...prev }
      if (status === current) delete next[row.user_id]
      else next[row.user_id] = status
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
    if (!rehearsalId || savingRef.current || changedRows.length === 0) return
    savingRef.current = true
    setSaving(true)
    let ok = 0
    const failedIds = new Set<string>()
    let firstCode = ''
    try {
      for (const row of changedRows) {
        const status = edits[row.user_id]
        const { data, error } = await supabase.rpc('president_update_attendance', {
          p_rehearsal_id: rehearsalId,
          p_user_id: row.user_id,
          p_status: status,
        })
        const result = data as { ok?: boolean; code?: string } | null
        if (error || !result?.ok) {
          failedIds.add(row.user_id)
          firstCode = error?.message ?? result?.code ?? ''
        } else {
          ok += 1
        }
      }
    } finally {
      savingRef.current = false
      setSaving(false)
    }

    await reload()
    if (failedIds.size === 0) {
      setEdits({})
      onSaved()
      void Taro.showToast({ title: t('president.attendance.saved'), icon: 'success' })
      return
    }
    // 失败的行保留编辑，成功/未改的行清掉，方便重试
    setEdits((prev) => {
      const next: Record<string, AttendanceEditStatus> = {}
      for (const [userId, status] of Object.entries(prev)) {
        if (failedIds.has(userId)) next[userId] = status
      }
      return next
    })
    void Taro.showModal({
      title: t('president.attendance.savePartial', {
        ok,
        failed: failedIds.size,
      }),
      content: mapDirectError(firstCode),
      showCancel: false,
    })
  }

  const requestClose = () => {
    if (savingRef.current) return
    onClose()
  }

  const rehearsalTitle =
    rehearsal?.repertoire || rehearsal?.title || t('president.attendance.unnamedRehearsal')

  return (
    <Modal
      open={open}
      onClose={requestClose}
      title={t('president.attendance.modalTitle')}
      position='bottom'
      closeOnOverlay={!saving}
    >
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
                  <Text className='block text-sm text-text'>{row.profiles?.full_name || '—'}</Text>
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
                    <StatusChip tone={ATTENDANCE_TONE[edited]}>{statusLabels[edited]}</StatusChip>
                    <Text className='text-xs text-text-muted' onClick={() => undoEdit(row.user_id)}>
                      {t('president.attendance.cancelEdit')}
                    </Text>
                  </View>
                ) : (
                  <View className='flex shrink-0 items-center gap-2'>
                    <StatusChip tone={ATTENDANCE_TONE[current]}>{statusLabels[current]}</StatusChip>
                    <Picker
                      mode='selector'
                      range={optionLabels}
                      value={pickerValue}
                      onChange={(event) => {
                        const status = ATTENDANCE_EDIT_OPTIONS[Number(event.detail.value)]
                        if (status) setEdit(row, status)
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

      <View className='mt-4'>
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
    </Modal>
  )
}
