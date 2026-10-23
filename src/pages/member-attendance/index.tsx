import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView, Textarea } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { usePageRestore } from '@/hooks/usePageRestore'
import { useProfiles } from '@/hooks/useProfiles'
import { ListState } from '@/components/ui/ListState'
import { StatusChip } from '@/components/ui/StatusChip'
import { formatRehearsalRange } from '@/lib/date-utils'
import { translateInstrument } from '@/lib/instrument-i18n'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import './index.scss'

type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused' | 'exempt'

const STATUS_OPTIONS: AttendanceStatus[] = ['present', 'late', 'absent', 'excused', 'exempt']

type RehearsalMini = {
  id: number
  type: string | null
  target_section: string[] | null
  start_time: string | null
  end_time: string | null
  location: string | null
  repertoire: string | null
}

type AttendanceWithRehearsal = {
  id: number
  status: AttendanceStatus | null
  rehearsal_id: number
  rehearsals: RehearsalMini | null
}

type PendingRow = { id: string; rehearsal_id: number; status: string }

/**
 * 成员详情（声部长/首席）：成员信息 + 该成员的排练列表 + 修改考勤。
 *
 * 提交不是直改：每条被改动的排练调用一次 `create_attendance_change_request`，
 * 由管理员/团长审批。当前考勤在审批前保持不变；页面用 pending 标记「已提交、待审批」。
 */
export default function MemberAttendancePage() {
  const { t } = useT()
  useNavTitle('memberAttendance.navTitle')
  const darkClass = useThemeClass()

  const cachedUserId = usePageRestore<string>('userId')
  const userId = cachedUserId ?? ''

  const {
    data: profileData,
    loading: profileLoading,
    error: profileError,
    fetch: fetchProfile,
  } = useProfiles({ userId: userId || undefined })
  const member = profileData[0]

  const [rows, setRows] = useState<AttendanceWithRehearsal[]>([])
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [edits, setEdits] = useState<Record<number, AttendanceStatus>>({})
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const statusLabels: Record<AttendanceStatus, string> = {
    present: t('memberAttendance.status.present'),
    late: t('memberAttendance.status.late'),
    absent: t('memberAttendance.status.absent'),
    excused: t('memberAttendance.status.excused'),
    exempt: t('memberAttendance.status.exempt'),
  }

  const rehearsalTypeLabel = (type: string | null): string =>
    type === 'section'
      ? t('sectionLeave.type.section')
      : type === 'full'
        ? t('sectionLeave.type.full')
        : t('sectionLeave.type.rehearsal')

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false)
      setFailed(true)
      return
    }
    setLoading(true)
    setFailed(false)
    const [attendanceRes, pendingRes] = await Promise.all([
      supabase
        .from('attendances')
        .select(
          'id, status, rehearsal_id, rehearsals(id, type, target_section, start_time, end_time, location, repertoire)'
        )
        .eq('user_id', userId),
      supabase
        .from('attendance_change_requests')
        .select('id, rehearsal_id, status')
        .eq('target_user_id', userId)
        .eq('status', 'pending'),
    ])

    if (attendanceRes.error) {
      setLoading(false)
      setFailed(true)
      return
    }

    const list = ((attendanceRes.data as unknown as AttendanceWithRehearsal[]) ?? [])
      .slice()
      .sort((a, b) =>
        (b.rehearsals?.start_time ?? '').localeCompare(a.rehearsals?.start_time ?? '')
      )

    setRows(list)
    setEdits(Object.fromEntries(list.map((r) => [r.rehearsal_id, r.status ?? 'absent'])))
    setPendingIds(
      new Set(((pendingRes.data as PendingRow[] | null) ?? []).map((p) => p.rehearsal_id))
    )
    setLoading(false)
  }, [userId])

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      setFailed(true)
      return
    }
    void load()
    void fetchProfile()
  }, [fetchProfile, load, userId])

  const changed = useMemo(
    () =>
      rows.filter(
        (r) => !pendingIds.has(r.rehearsal_id) && edits[r.rehearsal_id] !== (r.status ?? 'absent')
      ),
    [edits, pendingIds, rows]
  )

  const mapError = (message: string): string => {
    if (message.includes('pending_exists')) return t('memberAttendance.errors.pendingExists')
    if (message.includes('attendance_missing'))
      return t('memberAttendance.errors.attendanceMissing')
    if (message.includes('not_allowed')) return t('memberAttendance.errors.notAllowed')
    return t('memberAttendance.errors.generic')
  }

  const handleSubmit = async () => {
    if (changed.length === 0 || submitting) return
    setSubmitting(true)
    let ok = 0
    let failedCount = 0
    let firstError = ''

    for (const row of changed) {
      const { error } = await supabase.rpc('create_attendance_change_request', {
        p_rehearsal_id: row.rehearsal_id,
        p_target_user_id: userId,
        p_to_status: edits[row.rehearsal_id],
        p_reason: reason.trim() || undefined,
      })
      if (error) {
        failedCount += 1
        if (!firstError) firstError = error.message
      } else {
        ok += 1
      }
    }

    setSubmitting(false)
    if (ok > 0) {
      await load()
      setReason('')
    }

    if (failedCount > 0) {
      void Taro.showModal({
        title: t('memberAttendance.submitResult', { ok, failed: failedCount }),
        content: mapError(firstError),
        showCancel: false,
      })
    } else {
      void Taro.showToast({ title: t('memberAttendance.submitted'), icon: 'success' })
    }
  }

  const memberInfoPending = profileLoading && !member
  const memberInfoFailed = !!profileError && !member

  return (
    <View className={`${darkClass} flex h-full flex-col bg-page-bg`}>
      <ScrollView scrollY className='flex-1 min-h-0'>
        <View className='px-4 pt-3 pb-6'>
          {/* 成员信息 */}
          <View className='mb-3 rounded-xl border border-border bg-card p-4'>
            {memberInfoPending ? (
              <Text className='text-sm text-text-muted'>{t('common.actions.loading')}</Text>
            ) : memberInfoFailed ? (
              <Text className='text-sm text-danger'>{t('memberAttendance.loadFailed')}</Text>
            ) : (
              <>
                <View className='flex flex-wrap items-center gap-1.5'>
                  <Text className='text-base font-semibold text-text'>
                    {member?.full_name ?? '—'}
                  </Text>
                  {member?.is_section_leader && (
                    <StatusChip tone='warning'>
                      {t('memberAttendance.info.sectionLeader')}
                    </StatusChip>
                  )}
                  {member?.is_principal && (
                    <StatusChip tone='success'>{t('memberAttendance.info.principal')}</StatusChip>
                  )}
                </View>
                <View className='mt-2'>
                  <Text className='text-xs text-text-muted'>
                    {t('memberAttendance.info.instrument')}：
                  </Text>
                  <Text className='text-sm text-text'>
                    {translateInstrument(member?.instrument ?? '', t) || '—'}
                  </Text>
                </View>
                {member?.college?.trim() && (
                  <View className='mt-1'>
                    <Text className='text-xs text-text-muted'>
                      {t('memberAttendance.info.college')}：
                    </Text>
                    <Text className='text-sm text-text'>{member.college}</Text>
                  </View>
                )}
                {member?.email && (
                  <View className='mt-1'>
                    <Text className='text-xs text-text-muted'>
                      {t('memberAttendance.info.email')}：
                    </Text>
                    <Text className='text-sm text-text'>{member.email}</Text>
                  </View>
                )}
                {member?.phone_number && (
                  <View className='mt-1'>
                    <Text className='text-xs text-text-muted'>
                      {t('memberAttendance.info.phone')}：
                    </Text>
                    <Text className='text-sm text-text'>{member.phone_number}</Text>
                  </View>
                )}
              </>
            )}
          </View>

          <Text className='mb-2 block text-xs font-medium uppercase tracking-wide text-text-muted'>
            {t('memberAttendance.listTitle')}
          </Text>

          <ListState
            loading={loading}
            error={failed ? t('memberAttendance.loadFailed') : null}
            isEmpty={rows.length === 0}
            emptyText={t('memberAttendance.empty')}
            onRetry={() => void load()}
          >
            {rows.map((row) => {
              const rehearsal = row.rehearsals
              const typeText = rehearsalTypeLabel(rehearsal?.type ?? null)
              const timeText = rehearsal?.start_time
                ? formatRehearsalRange(rehearsal.start_time, rehearsal.end_time ?? null)
                : t('sectionLeave.timeUnset')
              const isPending = pendingIds.has(row.rehearsal_id)
              const selected = edits[row.rehearsal_id] ?? row.status ?? 'absent'
              return (
                <View
                  key={row.rehearsal_id}
                  className='mb-3 rounded-xl border border-border bg-card p-4'
                >
                  <Text className='block text-base font-semibold text-primary'>{timeText}</Text>
                  <View className='mt-1 flex flex-wrap items-center gap-1.5'>
                    <Text className='text-xs text-text-muted'>{typeText}</Text>
                    {rehearsal?.repertoire && (
                      <Text className='text-xs text-text-muted'>· {rehearsal.repertoire}</Text>
                    )}
                    {isPending && (
                      <StatusChip tone='warning'>{t('memberAttendance.pending')}</StatusChip>
                    )}
                  </View>

                  {isPending ? (
                    <View className='mt-2'>
                      <Text className='text-xs text-text-muted'>{statusLabels[selected]}</Text>
                    </View>
                  ) : (
                    <View className='mt-2 flex flex-wrap gap-1.5'>
                      {STATUS_OPTIONS.map((status) => {
                        const active = selected === status
                        return (
                          <View
                            key={status}
                            className={`rounded-full border px-2.5 py-1 ${
                              active ? 'border-primary bg-primary' : 'border-border bg-muted'
                            }`}
                            onClick={() =>
                              setEdits((prev) => ({ ...prev, [row.rehearsal_id]: status }))
                            }
                          >
                            <Text
                              className={`text-xs ${
                                active ? 'text-primary-foreground' : 'text-text'
                              }`}
                            >
                              {statusLabels[status]}
                            </Text>
                          </View>
                        )
                      })}
                    </View>
                  )}
                </View>
              )
            })}
          </ListState>
        </View>
      </ScrollView>

      {/* 底部：可选理由 + 提交 */}
      <View className='border-t border-border bg-surface px-4 pb-safe pt-2'>
        <Text className='mb-1 block text-xs text-text-muted'>
          {t('memberAttendance.reasonLabel')}
        </Text>
        <View className='mb-2 w-full overflow-hidden rounded-xl border border-border bg-muted px-3 py-2'>
          <Textarea
            className='h-20 w-full bg-transparent text-sm text-text'
            value={reason}
            onInput={(e) => setReason(e.detail.value)}
            placeholder={t('memberAttendance.reasonPlaceholder')}
            maxlength={200}
          />
        </View>
        <View
          className={`rounded-xl py-3 text-center ${
            changed.length > 0 && !submitting ? 'bg-primary' : 'bg-muted'
          }`}
          onClick={() => void handleSubmit()}
        >
          <Text
            className={`text-sm font-medium ${
              changed.length > 0 && !submitting ? 'text-primary-foreground' : 'text-text-muted'
            }`}
          >
            {submitting ? t('memberAttendance.submitting') : t('memberAttendance.submit')}
          </Text>
        </View>
      </View>
    </View>
  )
}
