import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, ScrollView, Textarea, Picker } from '@tarojs/components'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { usePageRestore } from '@/hooks/usePageRestore'
import { useProfiles } from '@/hooks/useProfiles'
import { useMemberPreference } from '@/hooks/useMemberPreference'
import { StatusChip } from '@/components/ui/StatusChip'
import { PageLoading } from '@/components/ui/PageLoading'
import { Spinner } from '@/components/ui/Spinner'
import { ProfileInfoView } from '@/components/profile/ProfileInfoView'
import { AttendanceCalendar } from '@/components/attendance/AttendanceCalendar'
import { formatRehearsalRange } from '@/lib/date-utils'
import { defaultSubPartNumbers, mergeSubPartOptions, resolveSubPartPolicy } from '@/lib/sub-parts'
import {
  ATTENDANCE_EDIT_OPTIONS,
  ATTENDANCE_TONE,
  addMonths,
  computeAttendanceStats,
  groupRowsByDate,
  isEditableAttendanceRow,
  localDateKey,
  monthOfDateKey,
  type AttendanceStatus,
} from '@/lib/attendance-calendar'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import { useUser } from '@/context/user-context'
import { usePlaceholderStyle } from '@/hooks/usePlaceholderStyle'
import { DATA_SYNC_INTERVAL_MS } from '@/lib/dataSync'
import './index.scss'

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
  // 0.6.2：详情页不再显示「成员考勤」导航标题（产品要求什么都不显示）
  useNavTitle('memberAttendance.navTitleBlank')
  const darkClass = useThemeClass()
  // 原生 Textarea 的 placeholder 吃不到 CSS 变量，必须显式传主题色（与 TextField 同一条路）
  const placeholderStyle = usePlaceholderStyle()

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
  /**
   * 能否管理该成员的考勤（0.6.2：详情页对所有人开放，只有有权限的人才显示考勤区）。
   * `null` = 查询中；查询失败按「不能管理」处理，避免把无权者的请求打出去。
   */
  const [canManage, setCanManage] = useState<boolean | null>(null)
  useEffect(() => {
    // 0.6.2：自己点自己只进只读详情页（即使自己是声部长/首席）
    if (!userId || (user?.id && user.id === userId)) {
      setCanManage(false)
      return
    }
    let cancelled = false
    void supabase
      .rpc('can_manage_member_attendance', { p_member: userId })
      .then(({ data, error }) => {
        if (!cancelled) setCanManage(!error && !!data)
      })
    return () => {
      cancelled = true
    }
  }, [user?.id, userId])
  const canPrefHint = canManage === true

  /** 默认分声部（P7'）：缓存优先、后台核对；见 useMemberPreference 的注释 */
  const {
    data: subPartData,
    loading: subPartLoading,
    save: saveSubPart,
  } = useMemberPreference({
    ownerId: user?.id ?? null,
    // 无管理权限时不要替别人拉偏好（RLS 会白跑一趟）
    memberId: canManage === true ? userId : '',
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
  const [pageActive, setPageActive] = useState(true)
  const firstShowRef = useRef(true)
  const submittingRef = useRef(false)

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

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!userId) {
      if (!silent) {
        setLoading(false)
        setFailed(true)
      }
      return
    }
    if (!silent) {
      setLoading(true)
      setFailed(false)
    }
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
      // 静默刷新失败时保留当前列表：管理员改考勤不该让正在看的页面突然变成失败态
      if (!silent) {
        setLoading(false)
        setFailed(true)
      }
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
    setFailed(false)
    if (!silent) setLoading(false)
  }, [userId])

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      setFailed(true)
      return
    }
    void fetchProfile()
    if (canManage === true) {
      void load()
    } else {
      // 没有考勤管理权：详情页只展示个人信息，不跑考勤查询
      setLoading(false)
    }
  }, [canManage, fetchProfile, load, userId])

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

  // ---- 0.6.2 日历 + 占比 ----
  const byDate = useMemo(() => groupRowsByDate(rows), [rows])
  const latestDate = useMemo(() => {
    let latest: string | null = null
    const now = Date.now()
    for (const row of rows) {
      // 默认落到最近一个**可修改**的日期；未来 / exempt 与「无排练」同处理
      if (!isEditableAttendanceRow(row, now)) continue
      const key = localDateKey(row.rehearsals?.start_time ?? null)
      if (key && (!latest || key > latest)) latest = key
    }
    return latest
  }, [rows])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  /** 切日期后把「当天排练」滚回视野（键盘收起/内容切换会把 ScrollView 顶回顶部） */
  const [scrollAnchor, setScrollAnchor] = useState('')
  const didInitDateRef = useRef(false)

  // 首次拿到数据时定位到最近一次排练的月份与日期；之后不再自动跳（用户翻月/选日优先）
  useEffect(() => {
    if (didInitDateRef.current || !latestDate) return
    didInitDateRef.current = true
    setSelectedDate(latestDate)
    const m = monthOfDateKey(latestDate)
    if (m) setCalendarMonth(m)
  }, [latestDate])

  const stats = useMemo(() => computeAttendanceStats(rows, Date.now()), [rows])
  const percent = (n: number, total: number): number =>
    total > 0 ? Math.round((n / total) * 100) : 0
  const selectedRows = useMemo(
    () =>
      selectedDate
        ? (byDate.get(selectedDate) ?? []).filter((row) =>
            isEditableAttendanceRow(row, Date.now())
          )
        : [],
    [byDate, selectedDate]
  )
  /** 提交只针对**当前展开的那一天**（产品 2026-11-10 定） */
  const selectedDayChangedRows = useMemo(
    () =>
      changedRows.filter(
        (row) => localDateKey(row.rehearsals?.start_time ?? null) === selectedDate
      ),
    [changedRows, selectedDate]
  )

  /** 切换日期前丢弃当天未提交的编辑，回到服务端/待审批值 */
  const revertDay = (dateKey: string | null) => {
    if (!dateKey) return
    const dayRows = byDate.get(dateKey) ?? []
    setEdits((prev) => {
      const next = { ...prev }
      for (const row of dayRows) {
        const p = pending.get(row.rehearsal_id)
        next[row.rehearsal_id] = p ? p.to_status : (row.status ?? 'absent')
      }
      return next
    })
    setReasons((prev) => {
      const next = { ...prev }
      for (const row of dayRows) {
        next[row.rehearsal_id] = pending.get(row.rehearsal_id)?.reason ?? ''
      }
      return next
    })
    setModifying((prev) => {
      const next = new Set(prev)
      for (const row of dayRows) next.delete(row.rehearsal_id)
      return next
    })
  }

  const selectDate = (dateKey: string) => {
    if (dateKey === selectedDate) return
    if (selectedDayChangedRows.length === 0) {
      setSelectedDate(dateKey)
      return
    }
    // 先收键盘：textarea 聚焦时弹 modal，收起键盘会把页面顶回顶部
    try {
      void Taro.hideKeyboard().catch(() => {})
    } catch {
      /* 部分环境无此 API */
    }
    void Taro.showModal({
      title: t('memberAttendance.unsavedTitle'),
      content: t('memberAttendance.unsavedHint'),
      // 微信限制 confirmText ≤ 4 个汉字；「丢弃并切换」会直接报错
      confirmText: t('memberAttendance.discardChanges'),
      success: (res) => {
        if (!res.confirm) return
        revertDay(selectedDate)
        setSelectedDate(dateKey)
        // 下一帧再滚回当天区块（等 React 把新日期的内容换完）
        setTimeout(() => {
          setScrollAnchor('member-attendance-day')
          setTimeout(() => setScrollAnchor(''), 400)
        }, 0)
      },
    })
  }

  const changeMonth = (delta: number) => {
    setCalendarMonth((prev) => addMonths(prev.year, prev.month, delta))
  }

  // 后台静默刷新只在「没有未提交修改」时跑：否则 30s 一次的重载会把用户正在填的
  // 状态/理由重置回服务端值。
  const changedRowsRef = useRef(0)
  changedRowsRef.current = changedRows.length
  const modifyingRef = useRef(0)
  modifyingRef.current = modifying.size

  // 从子页面返回时重拉；首帧由上面的 effect 负责。没有未提交修改才刷新，避免吃掉编辑。
  useDidShow(() => {
    setPageActive(true)
    if (firstShowRef.current) {
      firstShowRef.current = false
      return
    }
    if (canManage !== true) return
    if (submittingRef.current || changedRowsRef.current > 0 || modifyingRef.current > 0) return
    void load({ silent: true })
  })
  useDidHide(() => setPageActive(false))

  // 页面可见时每 30s 静默刷新：管理员直改考勤、或审批通过后，声部长停在本页也能看到
  // pending 消失、状态更新；有未提交修改时跳过。
  useEffect(() => {
    if (!pageActive || canManage !== true) return
    const timer = setInterval(() => {
      if (submittingRef.current || changedRowsRef.current > 0 || modifyingRef.current > 0) return
      void load({ silent: true })
    }, DATA_SYNC_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [canManage, pageActive, load])

  const mapError = (message: string): string => {
    if (message.includes('pending_exists')) return t('memberAttendance.errors.pendingExists')
    if (message.includes('attendance_missing'))
      return t('memberAttendance.errors.attendanceMissing')
    if (message.includes('exempt_not_editable'))
      return t('memberAttendance.errors.exemptNotEditable')
    if (message.includes('exempt_not_allowed'))
      return t('memberAttendance.errors.exemptNotAllowed')
    if (message.includes('not_allowed') || message.includes('not_request_owner'))
      return t('memberAttendance.errors.notAllowed')
    if (message.includes('request_not_pending') || message.includes('request_not_found'))
      return t('memberAttendance.errors.requestChanged')
    return t('memberAttendance.errors.generic')
  }

  const handleSubmit = async () => {
    if (selectedDayChangedRows.length === 0 || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    let ok = 0
    let failedCount = 0
    let firstError = ''

    for (const row of selectedDayChangedRows) {
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

    submittingRef.current = false
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
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    const { error } = await supabase.rpc('cancel_attendance_change_request', {
      p_request_id: requestId,
    })
    submittingRef.current = false
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

  // 0.6.2：资料没回来之前只显示**一个**加载态（转圈），别把下面各区块的占位一起叠出来
  if (memberInfoPending) {
    return <PageLoading darkClass={darkClass} />
  }
  if (memberInfoFailed) {
    return (
      <View className={`${darkClass} flex h-full flex-col bg-page-bg`}>
        <View className='flex flex-1 items-center justify-center px-4'>
          <Text className='text-sm text-danger'>{t('memberAttendance.loadFailed')}</Text>
        </View>
      </View>
    )
  }

  return (
    <View className={`${darkClass} flex h-full flex-col bg-page-bg`}>
      <ScrollView scrollY scrollIntoView={scrollAnchor} className='flex-1 min-h-0'>
        <View className='px-4 pt-3 pb-6'>
          {/* 个人信息：复用「我的 → 个人信息」布局（0.6.2） */}
          {member ? <ProfileInfoView profile={member} viewerId={user?.id ?? null} /> : null}

          {/* 没有考勤管理权：只展示个人信息（详情页对所有成员开放） */}
          {canManage === null ? (
            <View className='mt-3 flex justify-center rounded-xl border border-border bg-card p-6'>
              <Spinner size='sm' />
            </View>
          ) : null}

          {canManage === true ? (
            <>

          {/* 默认分声部：有写权才显示；弦乐整块不出（已有历史值例外，便于清除）；
              打击乐等暂未定义范围，只给「未设置」 */}
          {showSubPartCard ? (
            <View className='mt-3 rounded-xl border border-border bg-card p-4'>
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
                // 条件还没回来：用无文字的骨架占位，避免再叠一条「加载中」
                <View className='mt-3'>
                  <View className='h-10 w-full rounded-xl bg-muted' />
                </View>
              )}
            </View>
          ) : null}

          {!loading && !failed ? (
            <>
          {/* 出勤占比：排除 exempt 与未来；late 归入出勤（0.6.2） */}
          <View className='mt-3 rounded-xl border border-border bg-card p-4'>
            <Text className='text-sm font-medium text-text'>
              {t('memberAttendance.progress.title')}
            </Text>
            {stats.total > 0 ? (
              <>
                <View className='mt-2 flex h-3 w-full flex-row overflow-hidden rounded-full bg-muted'>
                  {stats.present > 0 ? (
                    <View
                      className='h-full bg-success'
                      style={{ width: `${(stats.present / stats.total) * 100}%` }}
                    />
                  ) : null}
                  {stats.absent > 0 ? (
                    <View
                      className='h-full bg-danger'
                      style={{ width: `${(stats.absent / stats.total) * 100}%` }}
                    />
                  ) : null}
                  {stats.excused > 0 ? (
                    <View
                      className='h-full bg-info'
                      style={{ width: `${(stats.excused / stats.total) * 100}%` }}
                    />
                  ) : null}
                </View>
                <View className='mt-2 flex flex-row flex-wrap gap-x-3 gap-y-1'>
                  <Text className='text-xs text-success'>
                    {t('memberAttendance.progress.present', {
                      n: percent(stats.present, stats.total),
                    })}
                  </Text>
                  <Text className='text-xs text-danger'>
                    {t('memberAttendance.progress.absent', {
                      n: percent(stats.absent, stats.total),
                    })}
                  </Text>
                  <Text className='text-xs text-info'>
                    {t('memberAttendance.progress.excused', {
                      n: percent(stats.excused, stats.total),
                    })}
                  </Text>
                </View>
              </>
            ) : (
              <Text className='mt-2 block text-xs text-text-muted'>
                {t('memberAttendance.progress.empty')}
              </Text>
            )}
          </View>

          <View className='mt-3'>
            <AttendanceCalendar
              year={calendarMonth.year}
              month={calendarMonth.month}
              byDate={byDate}
              selectedDate={selectedDate}
              onSelect={selectDate}
              onMonthChange={changeMonth}
              now={Date.now()}
            />
          </View>
            </>
          ) : null}

          {/* 当天排练：点日历里有排练的日期后显示 */}
          {loading ? (
            <View className='mt-3 flex justify-center rounded-xl border border-border bg-card p-6'>
              <Spinner size='sm' />
            </View>
          ) : failed ? (
            <View className='mt-3 rounded-xl border border-border bg-card p-4'>
              <Text className='text-sm text-danger'>{t('memberAttendance.loadFailed')}</Text>
              <View className='mt-2' onClick={() => void load()}>
                <Text className='text-xs text-primary'>{t('memberAttendance.retry')}</Text>
              </View>
            </View>
          ) : selectedDate ? (
            <View id='member-attendance-day' className='mt-3'>
              <Text className='mb-2 block text-sm font-medium text-text'>
                {t('memberAttendance.day.title', {
                  date: selectedDate,
                  n: selectedRows.length,
                })}
              </Text>
              {selectedRows.length === 0 ? (
                <Text className='block rounded-xl border border-border bg-card p-4 text-sm text-text-muted'>
                  {t('memberAttendance.day.empty')}
                </Text>
              ) : (
                selectedRows.map((row) => {
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
              // 0.6.2：textarea 始终显示（即使还没改状态）
              const showReason = showEditor
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
                  <View className='mt-1 flex flex-wrap items-center gap-1.5'>
                    <Text className='text-xs text-text-muted'>
                      {t('memberAttendance.currentStatus')}
                    </Text>
                    <StatusChip tone={ATTENDANCE_TONE[original]}>
                      {statusLabels[original]}
                    </StatusChip>
                  </View>

                  {p && !isModifying ? (
                    <>
                      <View className='mt-2 flex flex-wrap items-center gap-1.5'>
                        <Text className='text-xs text-text-muted'>
                          {t('memberAttendance.requestedStatus')}
                        </Text>
                        <StatusChip tone={ATTENDANCE_TONE[p.to_status]}>
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
                        {ATTENDANCE_EDIT_OPTIONS.map((status) => {
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
                              <StatusChip tone={ATTENDANCE_TONE[status]}>
                                {statusLabels[status]}
                              </StatusChip>
                            </View>
                          )
                        })}
                      </View>

                      {showReason ? (
                        <View className='mt-2'>
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
                              placeholderStyle={placeholderStyle}
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
                })
              )}
            </View>
          ) : (
            <Text className='mt-3 block rounded-xl border border-border bg-card p-4 text-sm text-text-muted'>
              {t('memberAttendance.day.pick')}
            </Text>
          )}
            </>
          ) : null}
        </View>
      </ScrollView>

      {/* 底部提交：只有当前展开的那天有改动才出现；底部留出安全区 + 16px，别贴着手机底边 */}
      {selectedDayChangedRows.length > 0 ? (
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
