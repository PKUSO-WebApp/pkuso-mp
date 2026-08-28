import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { useAttendance, type SignInResultRow } from '@/hooks/useAttendance'
import { useLeaveRequests } from '@/hooks/useLeaveRequests'
import { useUser } from '@/context/user-context'
import { formatRehearsalRange } from '@/lib/date-utils'
import { getSignBlockReason, hasSignedIn } from '@/lib/attendance-utils'
import { markRehearsalSeen } from '@/lib/rehearsalSeen'
import { withinCheckinGeofence } from '@/lib/geo'
import { logDiag } from '@/lib/session-diag'
import { FieldRow } from '@/components/ui/FieldRow'
import type { RehearsalRow } from '@/types/database'
import { useT } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'

const mapSignInError = (tf: (key: string, params?: Record<string, unknown>) => string, err: string): string => {
  const msg = err.toLowerCase()
  if (msg.includes('outside check-in geofence')) return tf('activityDetail.signIn.tooFar')
  if (msg.includes('check-in location is required')) return tf('activityDetail.signIn.locationRequired')
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
  const { map: attendanceMap, loading: attendanceLoading, fetchMyAttendances, signIn } = useAttendance()
  const { data: leaveRequests, cancelOnSignIn, fetchMine } = useLeaveRequests()
  const [nowTick, setNowTick] = useState(() => Date.now())
  const { t } = useT()

  // 详情页按 id 直接取这一条，不依赖排练列表/缓存的时序：
  // 列表在 subscribeSync 静默重取时可能某帧不含本排练，若靠列表查找会在 loading=false 时误显「排练不存在」。
  const [rehearsal, setRehearsal] = useState<RehearsalRow | null>(null)
  const [rehearsalLoading, setRehearsalLoading] = useState(true)
  useEffect(() => {
    if (!id) {
      setRehearsal(null)
      setRehearsalLoading(false)
      return
    }
    let cancelled = false
    setRehearsalLoading(true)
    void (async () => {
      const { data, error } = await supabase
        .from('rehearsals')
        .select('*')
        .eq('id', id)
        .single()
      if (cancelled) return
      if (error) {
        setRehearsal(null)
        setRehearsalLoading(false)
        return
      }
      setRehearsal((data as RehearsalRow) ?? null)
      setRehearsalLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [id])
  const attendance = attendanceMap[id] ?? null
  // 考勤记录加载中（map 尚无该行且请求未完成）：签到按钮渲染中性 disabled 态，
  // 与「已查无记录」区分，避免「可签到蓝 → 结果色」两段变色闪烁（P1-6）
  const attendancePending = attendanceLoading && attendance === null
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

  // 定位签到状态
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

  /** 按下签到 → 取定位（gcj02）→ 本地距离诊断打点 → 服务端围栏裁决 */
  const doGeoSignIn = (r: RehearsalRow) => {
    if (signingInRef.current) return
    signingInRef.current = true
    Taro.showLoading({ title: t('activityDetail.signIn.locating'), mask: true })
    Taro.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      success: (loc) => {
        const accuracy = typeof loc.accuracy === 'number' ? loc.accuracy : null
        const geo = withinCheckinGeofence(
          { latitude: loc.latitude, longitude: loc.longitude, accuracy },
          { lat: r.checkin_lat ?? null, lng: r.checkin_lng ?? null, radiusM: r.checkin_radius_m ?? null }
        )
        logDiag('checkin_distance', {
          rehearsalId: r.id,
          lat: loc.latitude,
          lng: loc.longitude,
          accuracy,
          distanceM: Math.round(geo.distanceM),
          radiusM: r.checkin_radius_m ?? null,
          localPass: geo.ok,
        })
        signIn({ rehearsal_id: r.id, latitude: loc.latitude, longitude: loc.longitude, accuracy })
          .then(({ error, row }) => {
            Taro.hideLoading()
            if (error) {
              void Taro.showToast({ title: mapSignInError(t, error), icon: 'none' })
              return
            }
            void handleSignInSuccess(r.id, row)
          })
          .catch(() => {
            Taro.hideLoading()
            void Taro.showToast({ title: t('activityDetail.signIn.failed'), icon: 'none' })
          })
      },
      fail: (err) => {
        Taro.hideLoading()
        const msg = (err?.errMsg ?? '').toLowerCase()
        logDiag('checkin_location_fail', { errMsg: err?.errMsg ?? '', rehearsalId: r.id })
        if (msg.includes('auth deny') || msg.includes('authorize') || msg.includes('permission')) {
          void Taro.showModal({
            title: t('activityDetail.signIn.locationDenied'),
            content: t('activityDetail.signIn.locationRequired'),
            confirmText: t('common.actions.openSettings'),
            cancelText: t('common.actions.cancel'),
            success: (res) => {
              if (res.confirm) void Taro.openSetting({})
            },
          })
        } else {
          void Taro.showToast({ title: t('activityDetail.signIn.locationFailed'), icon: 'none' })
        }
      },
      complete: () => {
        signingInRef.current = false
      },
    })
  }

  const requestSignIn = (r: RehearsalRow) => {
    if (!user) return
    const activeLeave =
      leaveRequest && (leaveRequest.status === 'pending' || leaveRequest.status === 'approved')
    if (activeLeave) {
      void Taro.showModal({
        title: t('activityDetail.revokeConfirmTitle'),
        content: t('activityDetail.revokeHint'),
        confirmText: t('common.actions.confirm'),
        cancelText: t('common.actions.cancel'),
        success: (res) => {
          if (res.confirm) doGeoSignIn(r)
        },
      })
      return
    }
    doGeoSignIn(r)
  }

  if (!rehearsal) {
    return (
    <View className={`${darkClass} flex h-full w-full flex-col overflow-hidden bg-page-bg`}>
      <View className='flex flex-1 items-center justify-center'>
        <Text className='text-xs text-text-muted'>{rehearsalLoading ? t('common.actions.loading') : t('activityDetail.notFound')}</Text>
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
  const rehearsalEnded = blockReason === 'ended'
  const canRequestLeave = !(attendance?.status === 'present' || attendance?.status === 'late')

  let signLabel = ''
  let signClass = 'bg-muted text-text-subtle'
  let signDisabled = true
  let onSign: (() => void) | null = null
  if (attendancePending) {
    // 加载中：中性灰 disabled，不预判任何结果色
    signLabel = t('common.actions.loading')
  } else if (signedIn) {
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
    signClass = 'bg-signin text-signin-foreground'
    signDisabled = false
    onSign = () => requestSignIn(rehearsal)
  }

  const timeText = rehearsal.start_time
    ? formatRehearsalRange(rehearsal.start_time, rehearsal.end_time ?? null)
    : t('activityDetail.timeUnset')
  const typeText = rehearsal.type === 'section' ? t('activityDetail.type.section') : t('activityDetail.type.full')

  return (
    <View className={`${darkClass} flex h-full w-full flex-col overflow-hidden bg-page-bg pb-safe`}>
      <ScrollView scrollY className='flex-1 min-h-0'>
        <View className='w-full px-4 pt-2 pb-4'>
        <Text className='block text-2xl font-semibold text-text'>{timeText}</Text>
        <Text className='mt-1 block text-sm text-text-muted'>{typeText}</Text>
        <View className='my-4 h-px bg-border' />
        <FieldRow layout='stacked' label={t('activityDetail.rows.time')} value={timeText} />
        <FieldRow layout='stacked' label={t('activityDetail.rows.location')} value={rehearsal.location || t('activityDetail.unset')} />
        <FieldRow layout='stacked' label={t('activityDetail.rows.repertoire')} value={rehearsal.repertoire || t('activityDetail.unset')} />
        <View className='mt-6'>
          <View
            className={`inline-flex h-11 w-full items-center justify-center rounded-xl px-4 text-center text-base font-medium ${signClass} ${
              signDisabled ? 'opacity-90' : ''
            }`}
            onClick={signDisabled ? undefined : (onSign ?? undefined)}
          >
            {signLabel}
          </View>
        </View>
        {canRequestLeave && (
          <View
            className='mt-3 flex items-center justify-center'
            onClick={() =>
              Taro.navigateTo({
                url: `/pages/leave-request/index?rehearsalId=${rehearsal.id}&start=${encodeURIComponent(
                  rehearsal.start_time ?? '',
                )}&end=${encodeURIComponent(rehearsal.end_time ?? '')}`,
              })
            }
          >
            <Text className='text-sm text-danger'>
              {t(rehearsalEnded ? 'activityDetail.requestLeaveRetro' : 'activityDetail.requestLeave')} &gt;
            </Text>
          </View>
        )}
       </View>
      </ScrollView>
    </View>
  )
}

