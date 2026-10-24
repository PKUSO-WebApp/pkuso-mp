import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView, Textarea, Picker } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { usePageRestore } from '@/hooks/usePageRestore'
import { useProfiles } from '@/hooks/useProfiles'
import { useMyProfile } from '@/hooks/useMyProfile'
import { useMemberPreference } from '@/hooks/useMemberPreference'
import { ListState } from '@/components/ui/ListState'
import { StatusChip, type StatusTone } from '@/components/ui/StatusChip'
import { formatRehearsalRange } from '@/lib/date-utils'
import { defaultSubPartNumbers, mergeSubPartOptions, resolveSubPartPolicy } from '@/lib/sub-parts'
import { translateInstrument } from '@/lib/instrument-i18n'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import { useUser } from '@/context/user-context'
import './index.scss'

type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused' | 'exempt'

const STATUS_OPTIONS: AttendanceStatus[] = ['present', 'late', 'absent', 'excused', 'exempt']

/** 状态色：与列表里的 StatusChip 同一套 token，不再所有按钮一个颜色 */
const STATUS_TONE: Record<AttendanceStatus, StatusTone> = {
  present: 'success',
  late: 'warning',
  absent: 'danger',
  excused: 'info',
  exempt: 'neutral',
}

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

type PendingRequest = {
  id: string
  to_status: AttendanceStatus
  reason: string | null
}

/**
 * 成员详情（声部长/首席）：成员信息 + 该成员的排练列表 + 修改考勤。
 *
 * 提交不是直改：每条被改动的排练调用一次 `create_attendance_change_request`，
 * 由管理员/团长审批。当前考勤在审批前保持不变；页面用 pending 标记「已提交、待审批」。
 *
 * pending 期间可以「取消请求」或「修改请求」：修改走
 * `update_attendance_change_request`（原位更新，不产生第二条 pending）。
 * 理由**逐行**填写——每条请求是独立的 DB 行，共用一个理由会丢掉「为什么改这一场」。
 */
export default function MemberAttendancePage() {
  const { t } = useT()
  useNavTitle('memberAttendance.navTitle')
  const darkClass = useThemeClass()

  const cachedUserId = usePageRestore<string>('userId')
  const userId = cachedUserId ?? ''
  // 从成员列表带过来的声部：让分声部卡片不必等 profile 查询回来
  const cachedSection = usePageRestore<string>('sec')
  const sectionFromRoute = cachedSection ? decodeURIComponent(cachedSection) : ''

  const {
    data: profileData,
    loading: profileLoading,
    error: profileError,
    fetch: fetchProfile,
  } = useProfiles({ userId: userId || undefined })
  const member = profileData[0]
  const memberInstrument = (member?.instrument ?? '').trim() || sectionFromRoute

  const { user } = useUser()
  const { profile: myProfile } = useMyProfile()
  /**
   * 用**已缓存**的 profile flags 先决定要不要占位：声部长/首席一定有可能写权限，
   * 卡片立刻显示（值未到就显示加载态）；只有 capability 的团长退回等 RPC。
   */
  const canPrefHint = !!myProfile?.is_section_leader || !!myProfile?.is_principal

  /** 默认分声部（P7'）：缓存优先、后台核对；见 useMemberPreference 的注释 */
  const {
    data: subPartData,
    loading: subPartLoading,
    save: saveSubPart,
  } = useMemberPreference({
    ownerId: user?.id ?? null,
    memberId: userId,
    instrument: memberInstrument,
  })
  const [savingSubPart, setSavingSubPart] = useState(false)

  const subPartPolicy = subPartData ? resolveSubPartPolicy(subPartData.groups) : null
  const subPartOptions =
    subPartData && subPartPolicy
      ? mergeSubPartOptions(
          subPartData.value,
          [subPartData.observedNumbers],
          defaultSubPartNumbers(subPartPolicy)
        )
      : []
  const subPart = subPartData?.value ?? null
  // Picker 的第 0 项是「未设置」；候选号从 1 开始
  const subPartLabels = [
    t('memberAttendance.subPart.unset'),
    ...subPartOptions.map((n) => t('memberAttendance.subPart.value', { n })),
  ]
  const subPartPickerValue =
    subPart == null ? 0 : Math.max(0, subPartOptions.indexOf(subPart) + 1)
  /**
   * 显隐：弦乐没有分声部概念 → 整块不显示（已有历史值仍显示，好让用户清掉）；
   * 数据未到但按缓存 flags 判断可能有写权 → 先占位（加载态），别让卡片晚一拍才出现。
   */
  const showSubPartCard = subPartData
    ? subPartData.canSet && (subPartPolicy !== 'none' || subPartData.value != null)
    : subPartLoading && canPrefHint && !!memberInstrument

  const changeSubPart = async (index: number) => {
    if (savingSubPart || !subPartData) return
    const next = index <= 0 ? null : (subPartOptions[index - 1] ?? null)
    if (next === subPartData.value) return
    setSavingSubPart(true)
    const ok = await saveSubPart(next)
    setSavingSubPart(false)
    if (!ok) {
      void Taro.showToast({ title: t('memberAttendance.subPart.saveFailed'), icon: 'none' })
      return
    }
    void Taro.showToast({ title: t('memberAttendance.subPart.saved'), icon: 'success' })
  }

  const [rows, setRows] = useState<AttendanceWithRehearsal[]>([])
  const [pending, setPending] = useState<Map<number, PendingRequest>>(new Map())
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [edits, setEdits] = useState<Record<number, AttendanceStatus>>({})
  const [reasons, setReasons] = useState<Record<number, string>>({})
  /** 哪些 pending 行正处在「修改请求」的编辑态 */
  const [modifying, setModifying] = useState<Set<number>>(new Set())
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
        .select('id, rehearsal_id, to_status, reason, status')
        .eq('target_user_id', userId)
        .eq('status', 'pending'),
    ])

    if (attendanceRes.error || pendingRes.error) {
      setLoading(false)
      setFailed(true)
      return
    }

    const list = ((attendanceRes.data as unknown as AttendanceWithRehearsal[]) ?? [])
      .slice()
      .sort((a, b) =>
        (b.rehearsals?.start_time ?? '').localeCompare(a.rehearsals?.start_time ?? '')
      )

    const pendingMap = new Map<number, PendingRequest>()
    for (const p of (pendingRes.data as {
      id: string
      rehearsal_id: number
      to_status: AttendanceStatus
      reason: string | null
    }[]) ?? []) {
      pendingMap.set(p.rehearsal_id, { id: p.id, to_status: p.to_status, reason: p.reason })
    }

    setRows(list)
    setPending(pendingMap)
    setEdits(Object.fromEntries(list.map((r) => [r.rehearsal_id, r.status ?? 'absent'])))
    setReasons(
      Object.fromEntries(
        list.map((r) => [r.rehearsal_id, pendingMap.get(r.rehearsal_id)?.reason ?? ''])
      )
    )
    setModifying(new Set())
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

  /** 真正需要提交的行：普通行比当前考勤；pending 行只在编辑态且状态/理由变了 */
  const changedRows = useMemo(
    () =>
      rows.filter((row) => {
        const p = pending.get(row.rehearsal_id)
        const selected = edits[row.rehearsal_id] ?? row.status ?? 'absent'
        if (p) {
          if (!modifying.has(row.rehearsal_id)) return false
          const reasonChanged = (reasons[row.rehearsal_id] ?? '').trim() !== (p.reason ?? '').trim()
          return selected !== p.to_status || reasonChanged
        }
        return selected !== (row.status ?? 'absent')
      }),
    [edits, modifying, pending, reasons, rows]
  )

  const mapError = (message: string): string => {
    if (message.includes('pending_exists')) return t('memberAttendance.errors.pendingExists')
    if (message.includes('attendance_missing'))
      return t('memberAttendance.errors.attendanceMissing')
    if (message.includes('not_allowed') || message.includes('not_request_owner'))
      return t('memberAttendance.errors.notAllowed')
    if (message.includes('request_not_pending') || message.includes('request_not_found'))
      return t('memberAttendance.errors.requestChanged')
    return t('memberAttendance.errors.generic')
  }

  const handleSubmit = async () => {
    if (changedRows.length === 0 || submitting) return
    setSubmitting(true)
    let ok = 0
    let failedCount = 0
    let firstError = ''

    for (const row of changedRows) {
      const p = pending.get(row.rehearsal_id)
      const toStatus = edits[row.rehearsal_id]
      const reason = (reasons[row.rehearsal_id] ?? '').trim() || undefined
      const { error } = p
        ? await supabase.rpc('update_attendance_change_request', {
            p_request_id: p.id,
            p_to_status: toStatus,
            p_reason: reason,
          })
        : await supabase.rpc('create_attendance_change_request', {
            p_rehearsal_id: row.rehearsal_id,
            p_target_user_id: userId,
            p_to_status: toStatus,
            p_reason: reason,
          })
      if (error) {
        failedCount += 1
        if (!firstError) firstError = error.message
      } else {
        ok += 1
      }
    }

    setSubmitting(false)
    if (ok > 0) await load()

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

  const cancelRequest = async (requestId: string) => {
    if (submitting) return
    setSubmitting(true)
    const { error } = await supabase.rpc('cancel_attendance_change_request', {
      p_request_id: requestId,
    })
    setSubmitting(false)
    if (error) {
      void Taro.showModal({
        title: t('memberAttendance.cancelFailed'),
        content: mapError(error.message),
        showCancel: false,
      })
      return
    }
    await load()
    void Taro.showToast({ title: t('memberAttendance.canceled'), icon: 'success' })
  }

  const confirmCancel = (requestId: string) => {
    void Taro.showModal({
      title: t('memberAttendance.cancelRequest'),
      content: t('memberAttendance.cancelConfirm'),
      success: (res) => {
        if (res.confirm) void cancelRequest(requestId)
      },
    })
  }

  const startModify = (rehearsalId: number, p: PendingRequest) => {
    setEdits((prev) => ({ ...prev, [rehearsalId]: p.to_status }))
    setReasons((prev) => ({ ...prev, [rehearsalId]: p.reason ?? '' }))
    setModifying((prev) => new Set(prev).add(rehearsalId))
  }

  const stopModify = (row: AttendanceWithRehearsal, p: PendingRequest) => {
    setEdits((prev) => ({ ...prev, [row.rehearsal_id]: row.status ?? 'absent' }))
    setReasons((prev) => ({ ...prev, [row.rehearsal_id]: p.reason ?? '' }))
    setModifying((prev) => {
      const next = new Set(prev)
      next.delete(row.rehearsal_id)
      return next
    })
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

          {/* 默认分声部：有写权才显示；弦乐整块不出（已有历史值例外，便于清除）；
              打击乐等暂未定义范围，只给「未设置」 */}
          {showSubPartCard ? (
            <View className='mb-3 rounded-xl border border-border bg-card p-4'>
              <View className='flex flex-row items-center justify-between'>
                <Text className='text-sm font-medium text-text'>
                  {t('memberAttendance.subPart.title')}
                </Text>
                {savingSubPart ? (
                  <Text className='text-xs text-text-muted'>
                    {t('memberAttendance.subPart.saving')}
                  </Text>
                ) : null}
              </View>
              <Text className='mt-1 block text-xs leading-relaxed text-text-muted'>
                {t('memberAttendance.subPart.hint')}
              </Text>
              {subPartData ? (
                <>
                  {subPartPolicy === 'unset-only' ? (
                    <Text className='mt-1 block text-xs text-text-subtle'>
                      {t('memberAttendance.subPart.noRange')}
                    </Text>
                  ) : null}
                  <Picker
                    mode='selector'
                    disabled={subPartOptions.length === 0}
                    range={subPartLabels}
                    value={subPartPickerValue}
                    onChange={(e) => void changeSubPart(Number(e.detail.value))}
                  >
                    <View className='mt-3 flex flex-row items-center justify-between rounded-xl border border-border bg-muted px-3 py-2'>
                      <Text className='text-sm text-text'>{subPartLabels[subPartPickerValue]}</Text>
                      <Text className='text-lg text-text-muted'>›</Text>
                    </View>
                  </Picker>
                </>
              ) : (
                // 条件还没回来：先占住卡片的位置，避免整块晚一拍才弹出来
                <View className='mt-3 rounded-xl border border-border bg-muted px-3 py-2'>
                  <Text className='text-sm text-text-muted'>{t('common.actions.loading')}</Text>
                </View>
              )}
            </View>
          ) : null}

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
              const p = pending.get(row.rehearsal_id)
              const isModifying = modifying.has(row.rehearsal_id)
              const selected = edits[row.rehearsal_id] ?? row.status ?? 'absent'
              const original = row.status ?? 'absent'
              const showEditor = !p || isModifying
              const showReason = showEditor && (isModifying || selected !== original)
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
                    {p && <StatusChip tone='warning'>{t('memberAttendance.pending')}</StatusChip>}
                  </View>

                  {p && !isModifying ? (
                    <>
                      <View className='mt-2 flex flex-wrap items-center gap-1.5'>
                        <Text className='text-xs text-text-muted'>
                          {t('memberAttendance.requestedStatus')}
                        </Text>
                        <StatusChip tone={STATUS_TONE[p.to_status]}>
                          {statusLabels[p.to_status]}
                        </StatusChip>
                      </View>
                      {p.reason ? (
                        <Text className='mt-1 block text-xs text-text-muted'>
                          {t('memberAttendance.reasonLabel')}
                          {p.reason}
                        </Text>
                      ) : null}
                      <View className='mt-3 flex flex-row gap-2'>
                        <View
                          className='flex-1 rounded-full border border-border bg-card px-3 py-2 text-center'
                          onClick={() => confirmCancel(p.id)}
                        >
                          <Text className='text-xs text-danger'>
                            {t('memberAttendance.cancelRequest')}
                          </Text>
                        </View>
                        <View
                          className='flex-1 rounded-full border border-border bg-card px-3 py-2 text-center'
                          onClick={() => startModify(row.rehearsal_id, p)}
                        >
                          <Text className='text-xs text-text'>
                            {t('memberAttendance.modifyRequest')}
                          </Text>
                        </View>
                      </View>
                    </>
                  ) : (
                    <>
                      <View className='mt-2 flex flex-wrap gap-1.5'>
                        {STATUS_OPTIONS.map((status) => {
                          const active = selected === status
                          return (
                            <View
                              key={status}
                              className={`rounded-full border-2 ${
                                active ? 'border-primary' : 'border-transparent'
                              }`}
                              onClick={() =>
                                setEdits((prev) => ({
                                  ...prev,
                                  [row.rehearsal_id]: status,
                                }))
                              }
                            >
                              <StatusChip tone={STATUS_TONE[status]}>
                                {statusLabels[status]}
                              </StatusChip>
                            </View>
                          )
                        })}
                      </View>

                      {showReason ? (
                        <View className='mt-2'>
                          <Text className='mb-1 block text-xs text-text-muted'>
                            {t('memberAttendance.reasonLabel')}
                          </Text>
                          <View className='w-full overflow-hidden rounded-xl border border-border bg-muted px-3 py-2'>
                            <Textarea
                              className='h-16 w-full bg-transparent text-sm text-text'
                              value={reasons[row.rehearsal_id] ?? ''}
                              onInput={(e) =>
                                setReasons((prev) => ({
                                  ...prev,
                                  [row.rehearsal_id]: e.detail.value,
                                }))
                              }
                              placeholder={t('memberAttendance.reasonPlaceholder')}
                              maxlength={200}
                            />
                          </View>
                        </View>
                      ) : null}

                      {p && isModifying ? (
                        <View
                          className='mt-2 flex flex-row justify-end'
                          onClick={() => stopModify(row, p)}
                        >
                          <Text className='text-xs text-text-muted'>
                            {t('memberAttendance.cancelEdit')}
                          </Text>
                        </View>
                      ) : null}
                    </>
                  )}
                </View>
              )
            })}
          </ListState>
        </View>
      </ScrollView>

      {/* 底部提交：只有真的有改动才出现；底部留出安全区 + 16px，别贴着手机底边 */}
      {changedRows.length > 0 ? (
        <View
          className='border-t border-border bg-surface px-4 pt-3'
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
        >
          <View
            className={`rounded-xl py-3 text-center ${!submitting ? 'bg-primary' : 'bg-muted'}`}
            onClick={() => void handleSubmit()}
          >
            <Text
              className={`text-sm font-medium ${
                !submitting ? 'text-primary-foreground' : 'text-text-muted'
              }`}
            >
              {submitting ? t('memberAttendance.submitting') : t('memberAttendance.submit')}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  )
}
