import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useRehearsals } from '@/hooks/useRehearsals'
import { useAttendance, type SignInResultRow } from '@/hooks/useAttendance'
import { useLeaveRequests } from '@/hooks/useLeaveRequests'
import { useUser } from '@/context/user-context'
import { formatRehearsalRange } from '@/lib/date-utils'
import { getSignBlockReason, hasSignedIn } from '@/lib/attendance-utils'
import { markRehearsalSeen } from '@/lib/rehearsalSeen'
import { CodeVerifyModal } from '@/pages/index/components/code-verify-modal'
import type { RehearsalRow } from '@/types/database'
import { useT } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'

const mapSignInError = (tf: (key: string, params?: Record<string, unknown>) => string, err: string): string => {
  const msg = err.toLowerCase()
  if (msg.includes('invalid sign-in code')) return tf('activityDetail.signIn.codeError')
  if (msg.includes('authentication required')) return tf('activityDetail.signIn.authRequired')
  if (msg.includes('not approved')) return tf('activityDetail.signIn.notApproved')
  if (msg.includes('outside the allowed window')) return tf('activityDetail.signIn.outsideWindow')
  if (msg.includes('already been signed')) return tf('activityDetail.signIn.alreadySigned')
  return tf('activityDetail.signIn.failed')
}

export default function RehearsalDetail() {
  const router = Taro.getCurrentInstance().router
  const id = Number(router?.params?.id)
  const darkClass = useThemeClass()
  const { user } = useUser()
  const { data: rehearsals, loading: rehearsalsLoading } = useRehearsals()
  const { map: attendanceMap, fetchMyAttendances, signIn } = useAttendance()
  const { data: leaveRequests, cancelOnSignIn, fetchMine } = useLeaveRequests()
  const [nowTick, setNowTick] = useState(() => Date.now())
  const { t } = useT()

  const rehearsal = useMemo<RehearsalRow | null>(
    () => rehearsals?.find((r) => r.id === id) ?? null,
    [rehearsals, id]
  )
  const attendance = attendanceMap[id] ?? null
  const leaveRequest = useMemo(
    () =>
      leaveRequests.find(
        (r) => r.rehearsal_id === id && r.status !== 'withdrawn' && r.status !== 'canceled'
      ) ?? null,
    [leaveRequests, id]
  )

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 60 * 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (user?.id && id) void fetchMyAttendances(user.id, [id])
    void fetchMine()
    if (id) markRehearsalSeen(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, id])

  // 从子页面（如请假申请）返回时本页未被卸载，需主动重取，
  // 否则刚提交的请假申请不会即时反映（覆盖签到按钮不出现）。
  useDidShow(() => {
    if (user?.id && id) void fetchMyAttendances(user.id, [id])
    void fetchMine()
  })

  // 签到码弹窗状态
  const [codeRehearsal, setCodeRehearsal] = useState<RehearsalRow | null>(null)
  const [codeInput, setCodeInput] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [codeSubmitting, setCodeSubmitting] = useState(false)
  const codeSubmittingRef = useRef(false)
  const signingInRef = useRef(false)

  const handleSignInSuccess = async (rehearsalId: number, row: SignInResultRow | null) => {
    void Taro.showToast({
      title: row?.status === 'late' ? t('activityDetail.toastSignedLate') : t('activityDetail.toastSigned'),
      icon: 'success',
    })
    const cancelResult = await cancelOnSignIn(rehearsalId)
    if (!cancelResult.ok && cancelResult.reason === 'network') {
      void Taro.showToast({ title: t('activityDetail.toastCancelLeaveFailed'), icon: 'none' })
    }
    if (user?.id) void fetchMyAttendances(user.id, [rehearsalId])
  }

  const doSectionSignIn = async (r: RehearsalRow) => {
    if (signingInRef.current) return
    signingInRef.current = true
    try {
      const { error, row } = await signIn({ rehearsal_id: r.id, code: '' })
      if (error) {
        void Taro.showToast({ title: mapSignInError(t, error), icon: 'none' })
        return
      }
      await handleSignInSuccess(r.id, row)
    } finally {
      signingInRef.current = false
    }
  }

  const requestSignIn = (r: RehearsalRow) => {
    if (!user) return
    if (r.type === 'full') {
      if (r.sign_in_code) {
        setCodeRehearsal(r)
        setCodeInput('')
        setCodeError(null)
      } else {
         void Taro.showToast({ title: t('activityDetail.noSignInCode'), icon: 'none' })
      }
      return
    }
    void doSectionSignIn(r)
  }

  const handleCodeConfirm = async () => {
    if (codeSubmittingRef.current || codeSubmitting || !codeRehearsal) return
    if (!/^\d{4}$/.test(codeInput)) {
      setCodeError(t('activityDetail.codeInvalid'))
      return
    }
    codeSubmittingRef.current = true
    setCodeSubmitting(true)
    try {
      const { error, row } = await signIn({ rehearsal_id: codeRehearsal.id, code: codeInput })
      if (!error) {
        const rid = codeRehearsal.id
        setCodeRehearsal(null)
        await handleSignInSuccess(rid, row)
      } else {
        setCodeError(mapSignInError(t, error))
      }
    } finally {
      codeSubmittingRef.current = false
      setCodeSubmitting(false)
    }
  }
  const handleCodeClose = () => {
    if (!codeSubmitting) setCodeRehearsal(null)
  }

  if (!rehearsal) {
    return (
    <View className={`${darkClass} flex h-full flex-col bg-page-bg`}>
      <View className='flex flex-1 items-center justify-center'>
        <Text className='text-xs text-text-muted'>{rehearsalsLoading ? t('common.actions.loading') : t('activityDetail.notFound')}</Text>
      </View>
    </View>
    )
  }

  // 签到按钮状态机
  const signedIn = hasSignedIn(attendance?.sign_in_time)
  const explicitStatus = attendance && attendance.status !== 'absent' ? attendance.status : null
  const leaveStatus = leaveRequest?.status ?? null
  const hasActiveLeaveRequest = leaveStatus === 'pending' || leaveStatus === 'approved'
  const blockReason = getSignBlockReason(rehearsal.start_time, rehearsal.end_time ?? null, new Date(nowTick))
  const canRequestLeave = !(attendance?.status === 'present' || attendance?.status === 'late')

  let signLabel = ''
  let signClass = 'bg-muted text-text-subtle'
  let signStyle: { backgroundColor: string } | undefined
  let signDisabled = true
  let onSign: (() => void) | null = null
  if (signedIn) {
    if (attendance?.status === 'late') {
      signLabel = t('activityDetail.status.late')
      signClass = 'bg-warning-bg text-warning'
    } else {
      signLabel = t('activityDetail.status.present')
      signClass = 'bg-success-bg text-success'
    }
  } else if (blockReason === 'not-started') {
    signLabel = t('activityDetail.status.notStarted')
  } else if (blockReason === 'ended') {
    if (explicitStatus === 'excused') {
      signLabel = t('activityDetail.status.excused')
      signClass = 'bg-warning-bg text-warning'
    } else {
      signLabel = t('activityDetail.status.absent')
      signClass = 'bg-danger-bg text-danger'
    }
  } else if (hasActiveLeaveRequest || explicitStatus === 'excused') {
    signLabel = t('activityDetail.status.override')
    signClass = 'bg-warning-bg text-warning'
    signDisabled = false
    onSign = () => requestSignIn(rehearsal)
  } else {
    signLabel = t('activityDetail.status.signIn')
    signClass = 'text-white'
    signStyle = { backgroundColor: '#6198CB' }
    signDisabled = false
    onSign = () => requestSignIn(rehearsal)
  }

  const timeText = rehearsal.start_time
    ? formatRehearsalRange(rehearsal.start_time, rehearsal.end_time ?? null)
    : t('activityDetail.timeUnset')
  const typeText = rehearsal.type === 'section' ? t('activityDetail.type.section') : t('activityDetail.type.full')

  return (
    <View className={`${darkClass} flex h-full flex-col bg-page-bg`}>
      <View className='flex-1 overflow-y-auto px-4 pb-safe'>
       <View className='pt-2 pb-2'>
        <Text className='block text-2xl font-semibold text-text'>{timeText}</Text>
        <Text className='mt-1 block text-sm text-text-muted'>{typeText}</Text>
        <View className='my-4 h-px bg-border' />
        <DetailRow label={t('activityDetail.rows.time')} value={timeText} />
        <DetailRow label={t('activityDetail.rows.location')} value={rehearsal.location || t('activityDetail.unset')} />
        <DetailRow label={t('activityDetail.rows.repertoire')} value={rehearsal.repertoire || t('activityDetail.unset')} />
        <View className='mt-6'>
          <View
            className={`inline-flex h-11 w-full items-center justify-center rounded-xl px-4 text-center text-base font-medium ${signClass} ${
              signDisabled ? 'opacity-90' : ''
            }`}
            style={signStyle}
            onClick={signDisabled ? undefined : (onSign ?? undefined)}
          >
            {signLabel}
          </View>
        </View>
        {canRequestLeave && (
          <View
            className='mt-3 flex items-center justify-center'
            onClick={() => Taro.navigateTo({ url: `/pages/leave-request/index?rehearsalId=${rehearsal.id}` })}
          >
            <Text className='text-sm text-danger'>{t('activityDetail.requestLeave')} &gt;</Text>
          </View>
        )}
       </View>
      </View>
      <CodeVerifyModal
        open={!!codeRehearsal}
        title={codeRehearsal?.repertoire ?? timeText}
        submitting={codeSubmitting}
        codeInput={codeInput}
        codeError={codeError}
        hint={
          hasActiveLeaveRequest
            ? t('activityDetail.revokeHint')
            : null
        }
        onCodeChange={(v) => {
          setCodeError(null)
          setCodeInput(v)
        }}
        onConfirm={handleCodeConfirm}
        onClose={handleCodeClose}
      />
    </View>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className='mb-3'>
      <Text className='block text-sm font-medium text-text'>{label}</Text>
      <Text className='mt-1 block text-sm text-text-muted'>{value}</Text>
    </View>
  )
}
