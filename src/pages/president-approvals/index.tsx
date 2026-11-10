import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, ScrollView, Text, Textarea, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { useUser } from '@/context/user-context'
import { useMyCapabilities } from '@/hooks/useMyCapabilities'
import { useThemeClass } from '@/context/theme-context'
import { useNavTitle, useT } from '@/i18n'
import {
  formatDateTimeInChina,
  formatRehearsalRange,
  normalizeScheduleTime,
} from '@/lib/date-utils'
import { SegmentTabs } from '@/components/ui/SegmentTabs'
import { ListState } from '@/components/ui/ListState'
import { StatusChip, type StatusTone } from '@/components/ui/StatusChip'
import { Modal } from '@/components/ui/Modal'
import { YesNoSwitch } from '@/components/ui/YesNoSwitch'
import type { AttendanceStatus } from '@/types/database'
import './index.scss'

type ApprovalTab = 'membership' | 'leave' | 'attendance'

type MembershipRow = {
  user_id: string
  full_name: string
  instrument: string
  email: string
  created_at: string
}

type LeaveRow = {
  request_id: string
  rehearsal_id: number
  user_id: string
  user_name: string
  user_instrument: string
  target_status: AttendanceStatus
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'canceled'
  reason: string
  attachment_url: string | null
  reject_reason: string | null
  created_at: string
  rehearsal_type: string | null
  rehearsal_title: string | null
  rehearsal_repertoire: string | null
  rehearsal_location: string | null
  rehearsal_start: string | null
  rehearsal_end: string | null
}

type AttendanceRequestRow = {
  request_id: string
  rehearsal_id: number
  target_user_id: string
  target_name: string
  target_instrument: string
  requested_by: string
  requester_name: string
  requester_instrument: string
  from_status: AttendanceStatus
  to_status: AttendanceStatus
  reason: string | null
  status: 'pending' | 'approved' | 'rejected' | 'canceled'
  reject_reason: string | null
  created_at: string
  decided_at: string | null
  rehearsal_type: string | null
  rehearsal_title: string | null
  rehearsal_repertoire: string | null
  rehearsal_location: string | null
  rehearsal_start: string | null
  rehearsal_end: string | null
}

type Rows = {
  membership: MembershipRow[]
  leave: LeaveRow[]
  attendance: AttendanceRequestRow[]
}

type Action = 'approve' | 'reject'

type DecisionResult = {
  ok: number
  fail: number
  stale: string[]
  signedIn: number
  exempt: number
}

const EMPTY_ROWS: Rows = { membership: [], leave: [], attendance: [] }

function tabFromParam(value: unknown): ApprovalTab {
  return value === 'leave' || value === 'attendance' || value === 'membership'
    ? value
    : 'membership'
}

function statusTone(status: string): StatusTone {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'danger'
  if (status === 'pending') return 'warning'
  return 'neutral'
}

function mergeResult(a: DecisionResult, b: DecisionResult): DecisionResult {
  return {
    ok: a.ok + b.ok,
    fail: a.fail + b.fail,
    stale: [...a.stale, ...b.stale],
    signedIn: a.signedIn + b.signedIn,
    exempt: a.exempt + b.exempt,
  }
}

export default function PresidentApprovalsPage() {
  const { t } = useT()
  useNavTitle('president.approval.navTitle')
  const darkClass = useThemeClass()
  const { user } = useUser()
  const { hasCapability, loading: capsLoading } = useMyCapabilities()
  const currentUserId = user?.id ?? ''
  const [tab, setTab] = useState<ApprovalTab>(() =>
    tabFromParam(Taro.getCurrentInstance().router?.params?.type)
  )
  const [rows, setRows] = useState<Rows>(EMPTY_ROWS)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [action, setAction] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const [force, setForce] = useState(false)
  const [acting, setActing] = useState(false)
  const [staleOpen, setStaleOpen] = useState(false)
  const staleIdsRef = useRef<string[]>([])
  const baseResultRef = useRef<DecisionResult | null>(null)
  const firstShowRef = useRef(true)

  const loadAll = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true)
      const membershipAllowed = hasCapability('membership_approval')
      const leaveAllowed = hasCapability('leave_approval')
      const attendanceAllowed = hasCapability('attendance_approval')
      const [membership, leave, attendance] = await Promise.all([
        membershipAllowed
          ? supabase.rpc('president_list_membership_requests')
          : Promise.resolve({ data: [], error: null }),
        leaveAllowed
          ? supabase.rpc('president_list_leave_requests')
          : Promise.resolve({ data: [], error: null }),
        attendanceAllowed
          ? supabase.rpc('president_list_attendance_change_requests')
          : Promise.resolve({ data: [], error: null }),
      ])
      setLoading(false)
      if (membership.error || leave.error || attendance.error) {
        setFailed(true)
        return
      }
      setFailed(false)
      setRows({
        membership: (membership.data as MembershipRow[] | null) ?? [],
        leave: (leave.data as LeaveRow[] | null) ?? [],
        attendance: (attendance.data as AttendanceRequestRow[] | null) ?? [],
      })
    },
    [hasCapability]
  )

  useEffect(() => {
    if (capsLoading) return
    void loadAll()
  }, [capsLoading, loadAll])

  useDidShow(() => {
    if (firstShowRef.current) {
      firstShowRef.current = false
      return
    }
    void loadAll({ silent: true })
  })

  const visibleRows = useMemo(() => {
    if (tab === 'membership') return rows.membership
    if (tab === 'leave') {
      return rows.leave.filter(
        (row) => row.status === 'pending' || row.status === 'approved' || row.status === 'rejected'
      )
    }
    return rows.attendance
  }, [rows, tab])

  const rowId = useCallback(
    (row: MembershipRow | LeaveRow | AttendanceRequestRow): string => {
      if (tab === 'membership') return (row as MembershipRow).user_id
      return (row as LeaveRow | AttendanceRequestRow).request_id
    },
    [tab]
  )

  const isSelf = useCallback(
    (row: MembershipRow | LeaveRow | AttendanceRequestRow): boolean => {
      if (tab === 'membership') return (row as MembershipRow).user_id === currentUserId
      if (tab === 'leave') return (row as LeaveRow).user_id === currentUserId
      return (row as AttendanceRequestRow).requested_by === currentUserId
    },
    [currentUserId, tab]
  )

  const isSelectable = useCallback(
    (row: MembershipRow | LeaveRow | AttendanceRequestRow): boolean => {
      if (tab === 'membership') return !isSelf(row)
      if (tab === 'leave') return (row as LeaveRow).status === 'pending' && !isSelf(row)
      // 考勤修改允许团长审批自己提出的申请（后端 president_decide_attendance_change_request
      // 已放开自审）；请假 / 入团仍排除自己。
      return (row as AttendanceRequestRow).status === 'pending'
    },
    [isSelf, tab]
  )

  const selectableIds = useMemo(
    () => visibleRows.filter(isSelectable).map(rowId),
    [isSelectable, rowId, visibleRows]
  )

  const counts = useMemo(
    () => ({
      membership: rows.membership.filter((row) => row.user_id !== currentUserId).length,
      leave: rows.leave.filter((row) => row.status === 'pending' && row.user_id !== currentUserId)
        .length,
      attendance: rows.attendance.filter((row) => row.status === 'pending').length,
    }),
    [currentUserId, rows]
  )

  const isSelectableById = (id: string) => {
    const row = visibleRows.find((item) => rowId(item) === id)
    return !!row && isSelectable(row)
  }

  const toggle = (id: string) => {
    if (!isSelectableById(id)) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearSelection = () => setSelected(new Set())

  const changeTab = (next: ApprovalTab) => {
    setTab(next)
    clearSelection()
  }

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      pending: t('leaveRequests.status.pending'),
      approved: t('leaveRequests.status.approved'),
      rejected: t('leaveRequests.status.rejected'),
      withdrawn: t('leaveRequests.status.withdrawn'),
      canceled: t('leaveRequests.status.canceled'),
    }
    return map[status] ?? status
  }

  const attendanceLabel = (status: AttendanceStatus) => {
    const map: Record<AttendanceStatus, string> = {
      present: t('memberAttendance.status.present'),
      late: t('memberAttendance.status.late'),
      absent: t('memberAttendance.status.absent'),
      excused: t('memberAttendance.status.excused'),
      exempt: t('memberAttendance.status.exempt'),
    }
    return map[status] ?? status
  }

  const rehearsalText = (
    start: string | null,
    end: string | null,
    type: string | null,
    repertoire: string | null,
    location: string | null
  ) => {
    const startNorm = start ? normalizeScheduleTime(start) : ''
    const endNorm = end ? normalizeScheduleTime(end) : null
    const when = startNorm ? formatRehearsalRange(startNorm, endNorm) : '—'
    const typeText =
      type === 'section' ? t('president.rehearsal.section') : t('president.rehearsal.full')
    return `${when} · ${typeText}${repertoire || location ? ` · ${repertoire || location}` : ''}`
  }

  const openAttachment = async (path: string | null) => {
    if (!path) return
    const { data, error } = await supabase.storage
      .from('leave-attachments')
      .createSignedUrl(path, 60)
    if (error || !data?.signedUrl) {
      void Taro.showToast({ title: t('president.approval.attachmentFailed'), icon: 'none' })
      return
    }
    if (path.toLowerCase().endsWith('.pdf')) {
      const download = await Taro.downloadFile({ url: data.signedUrl })
      if (download.statusCode !== 200) {
        void Taro.showToast({ title: t('president.approval.attachmentFailed'), icon: 'none' })
        return
      }
      await Taro.openDocument({ filePath: download.tempFilePath, fileType: 'pdf' })
    } else {
      await Taro.previewImage({ urls: [data.signedUrl] })
    }
  }

  const runDecision = async (
    ids: string[],
    nextAction: Action,
    rejectReason: string,
    forceApprove: boolean
  ): Promise<DecisionResult> => {
    const result: DecisionResult = { ok: 0, fail: 0, stale: [], signedIn: 0, exempt: 0 }
    for (const id of ids) {
      let response: { data: unknown; error: { message: string } | null }
      if (tab === 'membership') {
        response = await supabase.rpc('president_decide_membership_request', {
          p_user_id: id,
          p_approve: nextAction === 'approve',
        })
      } else if (tab === 'leave') {
        response = await supabase.rpc('president_decide_leave_request', {
          p_request_id: id,
          p_approve: nextAction === 'approve',
          p_reject_reason: nextAction === 'reject' ? rejectReason : undefined,
        })
      } else {
        response = await supabase.rpc('president_decide_attendance_change_request', {
          p_request_id: id,
          p_approve: nextAction === 'approve',
          p_reject_reason: nextAction === 'reject' ? rejectReason : undefined,
          p_force: forceApprove,
        })
      }
      if (response.error) {
        result.fail += 1
        continue
      }
      const data = response.data as {
        ok?: boolean
        code?: string
        warning?: string
      } | null
      if (data?.ok) {
        result.ok += 1
        if (data.warning === 'signed_in') result.signedIn += 1
        if (data.warning === 'exempt') result.exempt += 1
      } else if (
        data?.code === 'stale' &&
        tab === 'attendance' &&
        nextAction === 'approve' &&
        !forceApprove
      ) {
        result.stale.push(id)
      } else {
        result.fail += 1
      }
    }
    return result
  }

  const finish = (result: DecisionResult, decidedAction: Action) => {
    clearSelection()
    setAction(null)
    setStaleOpen(false)
    void loadAll({ silent: true })
    const parts = [t('president.approval.partial', { ok: result.ok, fail: result.fail })]
    if (result.signedIn > 0) {
      parts.push(t('president.approval.warningSignedIn', { count: result.signedIn }))
    }
    if (result.exempt > 0) {
      parts.push(t('president.approval.warningExempt', { count: result.exempt }))
    }
    if (result.fail > 0 || result.signedIn > 0 || result.exempt > 0) {
      void Taro.showModal({
        title: t('president.approval.navTitle'),
        content: parts.join('\n'),
        showCancel: false,
      })
    } else {
      void Taro.showToast({
        title:
          decidedAction === 'approve'
            ? t('president.approval.approved', { count: result.ok })
            : t('president.approval.rejected', { count: result.ok }),
        icon: 'success',
      })
    }
  }

  const confirmAction = async () => {
    if (!action || selected.size === 0 || acting) return
    if (action === 'reject' && tab !== 'membership' && !reason.trim()) {
      void Taro.showToast({ title: t('president.approval.rejectReasonRequired'), icon: 'none' })
      return
    }
    setActing(true)
    try {
      const ids = [...selected]
      const result = await runDecision(ids, action, reason.trim(), force)
      if (result.stale.length > 0) {
        staleIdsRef.current = result.stale
        baseResultRef.current = result
        setAction(null)
        setStaleOpen(true)
        return
      }
      finish(result, action)
    } finally {
      setActing(false)
    }
  }

  const confirmForce = async () => {
    if (acting || staleIdsRef.current.length === 0) return
    setActing(true)
    try {
      const forced = await runDecision(staleIdsRef.current, 'approve', '', true)
      const base = baseResultRef.current
      baseResultRef.current = null
      staleIdsRef.current = []
      finish(base ? mergeResult({ ...base, stale: [] }, forced) : forced, 'approve')
    } finally {
      setActing(false)
    }
  }

  const tabs = [
    {
      key: 'membership' as const,
      label: t('president.approval.tabMembership'),
      badge: counts.membership,
    },
    {
      key: 'leave' as const,
      label: t('president.approval.tabLeave'),
      badge: counts.leave,
    },
    {
      key: 'attendance' as const,
      label: t('president.approval.tabAttendance'),
      badge: counts.attendance,
    },
  ]

  const emptyText =
    tab === 'membership'
      ? t('president.approval.membershipEmpty')
      : tab === 'leave'
        ? t('president.approval.leaveEmpty')
        : t('president.approval.attendanceEmpty')

  return (
    <View className={`${darkClass} flex h-full flex-col bg-page-bg`}>
      <SegmentTabs tabs={tabs} value={tab} onChange={changeTab} />

      <ScrollView scrollY className='flex-1 min-h-0'>
        <View className='px-4 pb-4 pt-1'>
          {selectableIds.length > 0 && (
            <View className='mb-2 flex items-center justify-between'>
              <Text className='text-xs text-text-muted'>
                {t('president.approval.selected', { count: selected.size })}
              </Text>
              <Text
                className='text-xs text-primary'
                onClick={() => {
                  if (selected.size === selectableIds.length) clearSelection()
                  else setSelected(new Set(selectableIds))
                }}
              >
                {t('president.approval.selectAll')}
              </Text>
            </View>
          )}

          <ListState
            loading={loading}
            loadingOnlyWhenEmpty={false}
            isEmpty={visibleRows.length === 0}
            emptyText={emptyText}
            error={failed ? t('president.approval.loadFailed') : null}
            onRetry={() => void loadAll()}
          >
            {visibleRows.map((row) => {
              const id = rowId(row)
              const selectable = isSelectable(row)
              const checked = selected.has(id)
              const self = isSelf(row)
              return (
                <View
                  key={id}
                  className={`mb-2 rounded-2xl border bg-card p-3 ${
                    checked ? 'border-primary' : 'border-border'
                  }`}
                  onClick={() => toggle(id)}
                >
                  <View className='flex items-start gap-2'>
                    {selectable ? (
                      <View
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                          checked
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-surface'
                        }`}
                      >
                        <Text className='text-[10px]'>{checked ? '✓' : ''}</Text>
                      </View>
                    ) : (
                      <View className='mt-0.5 h-5 w-5 shrink-0' />
                    )}
                    <View className='min-w-0 flex-1'>
                      {tab === 'membership' && (
                        <>
                          <View className='flex items-center gap-2'>
                            <Text className='min-w-0 flex-1 text-sm font-medium text-text'>
                              {(row as MembershipRow).full_name || '—'}
                            </Text>
                            {self && (
                              <StatusChip tone='neutral'>{t('president.approval.self')}</StatusChip>
                            )}
                          </View>
                          <Text className='mt-1 block text-xs text-text-muted'>
                            {(row as MembershipRow).instrument || '—'} ·{' '}
                            {(row as MembershipRow).email || '—'}
                          </Text>
                          <Text className='mt-1 block text-[10px] text-text-muted'>
                            {formatDateTimeInChina((row as MembershipRow).created_at)}
                          </Text>
                        </>
                      )}

                      {tab === 'leave' && (
                        <>
                          <View className='flex items-center gap-2'>
                            <Text className='min-w-0 flex-1 text-sm font-medium text-text'>
                              {(row as LeaveRow).user_name || '—'} ·{' '}
                              {(row as LeaveRow).user_instrument || '—'}
                            </Text>
                            <StatusChip tone={statusTone((row as LeaveRow).status)}>
                              {statusLabel((row as LeaveRow).status)}
                            </StatusChip>
                          </View>
                          <Text className='mt-1 block text-xs text-text-muted'>
                            {rehearsalText(
                              (row as LeaveRow).rehearsal_start,
                              (row as LeaveRow).rehearsal_end,
                              (row as LeaveRow).rehearsal_type,
                              (row as LeaveRow).rehearsal_repertoire,
                              (row as LeaveRow).rehearsal_location
                            )}
                          </Text>
                          <Text className='mt-1 block text-xs text-text-muted'>
                            {t('president.approval.reason')}: {(row as LeaveRow).reason || '—'} ·{' '}
                            {t('president.approval.status')}:{' '}
                            {attendanceLabel((row as LeaveRow).target_status)}
                          </Text>
                          {((row as LeaveRow).attachment_url || self) && (
                            <View className='mt-1 flex gap-2'>
                              {(row as LeaveRow).attachment_url && (
                                <Text
                                  className='text-xs text-primary'
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void openAttachment((row as LeaveRow).attachment_url)
                                  }}
                                >
                                  {t('president.approval.attachment')}
                                </Text>
                              )}
                              {self && (
                                <Text className='text-xs text-text-muted'>
                                  {t('president.approval.self')}
                                </Text>
                              )}
                            </View>
                          )}
                          {(row as LeaveRow).reject_reason && (
                            <Text className='mt-1 block text-xs text-danger'>
                              {t('president.approval.rejectReason')}:{' '}
                              {(row as LeaveRow).reject_reason}
                            </Text>
                          )}
                        </>
                      )}

                      {tab === 'attendance' && (
                        <>
                          <View className='flex items-center gap-2'>
                            <Text className='min-w-0 flex-1 text-sm font-medium text-text'>
                              {(row as AttendanceRequestRow).target_name || '—'} ·{' '}
                              {(row as AttendanceRequestRow).target_instrument || '—'}
                            </Text>
                            <StatusChip tone={statusTone((row as AttendanceRequestRow).status)}>
                              {statusLabel((row as AttendanceRequestRow).status)}
                            </StatusChip>
                          </View>
                          <Text className='mt-1 block text-xs text-text-muted'>
                            {rehearsalText(
                              (row as AttendanceRequestRow).rehearsal_start,
                              (row as AttendanceRequestRow).rehearsal_end,
                              (row as AttendanceRequestRow).rehearsal_type,
                              (row as AttendanceRequestRow).rehearsal_repertoire,
                              (row as AttendanceRequestRow).rehearsal_location
                            )}
                          </Text>
                          <Text className='mt-1 block text-xs text-text-muted'>
                            {t('president.approval.fromTo', {
                              from: attendanceLabel((row as AttendanceRequestRow).from_status),
                              to: attendanceLabel((row as AttendanceRequestRow).to_status),
                            })}{' '}
                            · {t('president.approval.requester')}:{' '}
                            {(row as AttendanceRequestRow).requester_name || '—'}
                          </Text>
                          {(row as AttendanceRequestRow).reason && (
                            <Text className='mt-1 block text-xs text-text-muted'>
                              {t('president.approval.reason')}:{' '}
                              {(row as AttendanceRequestRow).reason}
                            </Text>
                          )}
                          {(row as AttendanceRequestRow).reject_reason && (
                            <Text className='mt-1 block text-xs text-danger'>
                              {t('president.approval.rejectReason')}:{' '}
                              {(row as AttendanceRequestRow).reject_reason}
                            </Text>
                          )}
                          {self && (
                            <Text className='mt-1 block text-xs text-text-muted'>
                              {t('president.approval.self')}
                            </Text>
                          )}
                        </>
                      )}
                    </View>
                  </View>
                </View>
              )
            })}
          </ListState>
        </View>
      </ScrollView>

      {selected.size > 0 && (
        <View
          className='flex gap-2 border-t border-border bg-surface px-4 pt-3'
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
        >
          <Button
            hoverClass='none'
            disabled={acting}
            className='m-0 flex-1 rounded-xl border border-danger bg-surface py-2 text-sm leading-normal text-danger disabled:opacity-50'
            onClick={() => {
              setReason('')
              setForce(false)
              setAction('reject')
            }}
          >
            {t('president.approval.reject')}
          </Button>
          <Button
            hoverClass='none'
            disabled={acting}
            className='m-0 flex-1 rounded-xl bg-primary py-2 text-sm leading-normal text-primary-foreground disabled:opacity-50'
            onClick={() => {
              setReason('')
              setForce(false)
              setAction('approve')
            }}
          >
            {t('president.approval.approve')}
          </Button>
        </View>
      )}

      <Modal
        open={action !== null}
        onClose={() => !acting && setAction(null)}
        title={
          action === 'reject' ? t('president.approval.reject') : t('president.approval.approve')
        }
        position='center'
        closeOnOverlay={!acting}
      >
        <Text className='block text-sm text-text-muted'>
          {action === 'reject'
            ? t('president.approval.rejectConfirm', { count: selected.size })
            : t('president.approval.approveConfirm', { count: selected.size })}
        </Text>
        {action === 'reject' && tab !== 'membership' && (
          <View className='mt-3'>
            <Text className='mb-1 block text-xs font-medium text-text-muted'>
              {t('president.approval.rejectReason')}
            </Text>
            <View className='w-full overflow-hidden rounded-xl border border-border bg-muted p-2'>
              <Textarea
                value={reason}
                className='h-24 w-full bg-transparent text-sm text-text'
                placeholder={t('president.approval.rejectReason')}
                placeholderStyle='color: var(--color-text-muted)'
                onInput={(event) => setReason(String(event.detail.value ?? ''))}
              />
            </View>
          </View>
        )}
        {action === 'approve' && tab === 'attendance' && (
          <View className='mt-3 flex items-center justify-between'>
            <Text className='text-xs text-text-muted'>{t('president.approval.force')}</Text>
            <YesNoSwitch value={force} onChange={setForce} />
          </View>
        )}
        <View className='mt-4 flex gap-2'>
          <Button
            hoverClass='none'
            className='m-0 flex-1 rounded-xl border border-border bg-surface py-2 text-sm leading-normal text-text'
            onClick={() => setAction(null)}
          >
            {t('common.actions.cancel')}
          </Button>
          <Button
            hoverClass='none'
            disabled={acting}
            className='m-0 flex-1 rounded-xl bg-primary py-2 text-sm leading-normal text-primary-foreground disabled:opacity-50'
            onClick={() => void confirmAction()}
          >
            {acting ? t('common.actions.loading') : t('common.actions.confirm')}
          </Button>
        </View>
      </Modal>

      <Modal
        open={staleOpen}
        onClose={() => !acting && setStaleOpen(false)}
        title={t('president.approval.stale', { count: staleIdsRef.current.length })}
        position='center'
      >
        <View className='mt-4 flex gap-2'>
          <Button
            hoverClass='none'
            className='m-0 flex-1 rounded-xl border border-border bg-surface py-2 text-sm leading-normal text-text'
            onClick={() => setStaleOpen(false)}
          >
            {t('common.actions.cancel')}
          </Button>
          <Button
            hoverClass='none'
            disabled={acting}
            className='m-0 flex-1 rounded-xl bg-primary py-2 text-sm leading-normal text-primary-foreground disabled:opacity-50'
            onClick={() => void confirmForce()}
          >
            {acting ? t('common.actions.loading') : t('common.actions.confirm')}
          </Button>
        </View>
      </Modal>
    </View>
  )
}
