import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useRehearsals } from '@/hooks/useRehearsals'
import { useAttendance, type SignInResultRow } from '@/hooks/useAttendance'
import { useLeaveRequests } from '@/hooks/useLeaveRequests'
import { useAnnouncements } from '@/hooks/useAnnouncements'
import { useMyProfile } from '@/hooks/useMyProfile'
import { useUser } from '@/context/user-context'
import { useThemeClass } from '@/context/theme-context'
import { dataSyncBump } from '@/lib/dataSync'
import { formatDateTimeInChina } from '@/lib/date-utils'
import { Toggle } from '@/components/ui/Toggle'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { AdminBlockedPage } from '@/components/admin-blocked-page'
import { PageHeader } from '@/components/page-header'

import { isRehearsalWithinNextWeek } from '@/lib/rehearsal-utils'
import {
  isRehearsalUpdated,
  isRehearsalEnded,
  sortRehearsalsForMember,
  sortEndedFullRehearsals,
} from '@/lib/rehearsal-sort'
import type { RehearsalRow, LeaveRequestRow } from '@/types/database'
import { RehearsalCard } from './components/rehearsal-card'
import { CodeVerifyModal } from './components/code-verify-modal'
import { RehearsalDetailModal } from './components/rehearsal-detail-modal'
import { LeaveRequestModal } from './components/leave-request-modal'
import './index.scss'

// 签到失败错误归一化中文文案（合排签到码弹窗与分排直签共用）
const mapSignInError = (err: string): string => {
  const msg = err.toLowerCase()
  if (msg.includes('invalid sign-in code')) return '签到码错误'
  if (msg.includes('authentication required')) return '请先登录'
  if (msg.includes('not approved')) return '账号未通过审核'
  if (msg.includes('outside the allowed window')) return '不在签到时间窗口内'
  if (msg.includes('already been signed')) return '已签到，不可重复签到'
  return '签到失败'
}

export default function Index() {
  const { data: rehearsals, loading: rehearsalsLoading, error: rehearsalsError, fetch: fetchRehearsals } =
    useRehearsals()
  const {
    data: announcement,
    loading: announcementLoading,
    fetch: fetchAnnouncement,
  } = useAnnouncements()
  const { user } = useUser()
  const {
    map: attendanceMap,
    loading: attendanceLoading,
    fetchMyAttendances,
    signIn,
  } = useAttendance()
  const { profile: myProfile } = useMyProfile()
  const darkClass = useThemeClass()

  // 签到覆盖请假：签到成功后撤销该排练 pending/approved 申请（best-effort，失败不阻断签到）
  const { data: leaveRequests, cancelOnSignIn, fetchMine: fetchLeaveMine } = useLeaveRequests()

  // A：每次切回首页重新拉取排练与请假，并重置全局轮询计时器
  useDidShow(() => {
    void fetchRehearsals()
    void fetchLeaveMine()
    void fetchAnnouncement()
    dataSyncBump()
  })

  const profileName = myProfile?.full_name ?? null

  const [scheduleTab, setScheduleTab] = useState<'full' | 'section' | 'history'>('full')
  const [nowTick, setNowTick] = useState(() => Date.now())

  // 欢迎语：显示 5 秒后淡出
  const [welcomeVisible, setWelcomeVisible] = useState(true)
  const [welcomeMounted, setWelcomeMounted] = useState(true)

  useEffect(() => {
    if (!user) return
    const fadeTimer = setTimeout(() => setWelcomeVisible(false), 5000)
    const unmountTimer = setTimeout(() => setWelcomeMounted(false), 5500)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(unmountTimer)
    }
  }, [user])

  // 每分钟更新 nowTick，驱动列表过滤与签到按钮状态更新
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 60 * 1000)
    return () => clearInterval(timer)
  }, [])

  // 签到码弹窗
  const [codeRehearsal, setCodeRehearsal] = useState<RehearsalRow | null>(null)
  const [codeInput, setCodeInput] = useState('')
  const [codeSubmitting, setCodeSubmitting] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  const codeSubmittingRef = useRef(false)
  // 分排直签路径防重复提交（同步 ref 阻断连点触发的第二次 RPC）
  const signingInRef = useRef(false)
  // 详情弹窗当前展示的排练（整卡点击打开，只读）
  const [detailRehearsal, setDetailRehearsal] = useState<RehearsalRow | null>(null)
  // 请假面板当前绑定的排练（详情弹窗「我要请假 ＞」打开，叠加在详情之上）
  const [leaveRehearsal, setLeaveRehearsal] = useState<RehearsalRow | null>(null)
  // 公告详情弹窗（成员主页顶部公告条点击打开）
  const [showAnnouncementDetail, setShowAnnouncementDetail] = useState(false)

  // 加载我的考勤
  useEffect(() => {
    if (!user?.id || !rehearsals) return
    const ids = rehearsals.map((r) => r.id)
    void fetchMyAttendances(user.id, ids)
  }, [user?.id, rehearsals, fetchMyAttendances])

  // 过滤 + 排序后的排练列表
  const list = useMemo(() => {
    if (!rehearsals) return []
    const now = new Date(nowTick)
    // 历史合排（Issue #154）：全部已结束的合排，不限一周窗口
    if (scheduleTab === 'history') {
      return sortEndedFullRehearsals(rehearsals, now)
    }
    const filtered = rehearsals.filter(
      (r) => r.type === scheduleTab && isRehearsalWithinNextWeek(r.start_time, now)
    )
    return sortRehearsalsForMember(filtered, now)
  }, [rehearsals, scheduleTab, nowTick])

  // 每场排练最近的「有效」（未撤回/未取消）申请（fetchMine 已按 created_at 倒序，首个命中即最新；
  // 已取消视同无申请，卡片显示「请假」可重新提交，Issue #149）
  const leaveRequestMap = useMemo(() => {
    const m: Record<number, LeaveRequestRow> = {}
    for (const r of leaveRequests) {
      if (r.status === 'withdrawn' || r.status === 'canceled') continue
      if (!(r.rehearsal_id in m)) m[r.rehearsal_id] = r
    }
    return m
  }, [leaveRequests])

  // 覆盖请假提醒（Issue #155）：该排练存在 pending/approved 申请时，
  // 签到码弹窗提示「签到会覆盖请假状态」；已驳回维持不变（不提示）
  const codeOverrideHint = useMemo(() => {
    if (!codeRehearsal) return null
    const req = leaveRequestMap[codeRehearsal.id]
    if (req && (req.status === 'pending' || req.status === 'approved')) {
      return '请假后签到会覆盖请假状态，并记录实际出勤'
    }
    return null
  }, [codeRehearsal, leaveRequestMap])

  // 签到成功后续（合排/分排共用）：按服务端返回状态提示、覆盖请假 best-effort、刷新考勤 map
  const handleSignInSuccess = async (rehearsalId: number, row: SignInResultRow | null) => {
    void Taro.showToast({
      title: row?.status === 'late' ? '签到成功，已记录迟到' : '签到成功',
      icon: 'success',
    })
    // 覆盖请假（与 Web 端一致）：撤销该排练 pending/approved 申请；失败不阻断已成功的签到，
    // 仅网络/DB 失败时提示联系管理员（already-processed 为中性告知）
    const cancelResult = await cancelOnSignIn(rehearsalId)
    if (!cancelResult.ok && cancelResult.reason === 'network') {
      void Taro.showToast({ title: '签到成功，但请假申请取消失败，请联系管理员', icon: 'none' })
    }
    if (user?.id && rehearsals) {
      await fetchMyAttendances(
        user.id,
        rehearsals.map((r) => r.id)
      )
    }
  }

  // 签到按钮点击：合排 → 签到码弹窗（无码提示）；分排 → 直签（RPC 空码）
  const handleSignIn = (rehearsal: RehearsalRow) => {
    if (!user) return
    if (rehearsal.type === 'full') {
      if (rehearsal.sign_in_code) {
        setCodeRehearsal(rehearsal)
        setCodeInput('')
        setCodeError(null)
      } else {
        void Taro.showToast({ title: '该排练未配置签到码', icon: 'none' })
      }
      return
    }
    void handleSectionSignIn(rehearsal)
  }

  // 分排直签：无签到码，直接走 sign_in_attendance RPC（服务端忽略空码）
  const handleSectionSignIn = async (rehearsal: RehearsalRow) => {
    if (signingInRef.current) return
    signingInRef.current = true
    try {
      const { error, row } = await signIn({ rehearsal_id: rehearsal.id, code: '' })
      if (error) {
        void Taro.showToast({ title: mapSignInError(error), icon: 'none' })
        return
      }
      await handleSignInSuccess(rehearsal.id, row)
    } finally {
      signingInRef.current = false
    }
  }

  // 签到码弹窗确认：走 sign_in_attendance RPC
  const handleCodeConfirm = async () => {
    if (codeSubmittingRef.current || codeSubmitting) return
    if (!codeRehearsal || !user || !rehearsals) return

    if (!/^\d{4}$/.test(codeInput)) {
      setCodeError('请输入四位数字')
      return
    }

    codeSubmittingRef.current = true
    setCodeSubmitting(true)
    try {
      const { error, row } = await signIn({
        rehearsal_id: codeRehearsal.id,
        code: codeInput,
      })
      if (!error) {
        setCodeRehearsal(null)
        await handleSignInSuccess(codeRehearsal.id, row)
      } else {
        setCodeError(mapSignInError(error))
      }
    } finally {
      codeSubmittingRef.current = false
      setCodeSubmitting(false)
    }
  }

  // 关闭签到码弹窗（提交中不关闭）
  const handleCodeClose = () => {
    if (!codeSubmitting) setCodeRehearsal(null)
  }

  // 管理端登录：不提供小程序管理端，显示阻断页（规划 §1：admin 留在 Web）
  if (myProfile?.role === 'admin') {
    return <AdminBlockedPage />
  }

  return (
    <View className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg px-4 pb-safe`}>
      {/* 欢迎语（5 秒后淡出消失） */}
      {user && welcomeMounted && (
        <View
          className={`mt-4 transition-opacity py-2 duration-300 ${
            welcomeVisible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <Text className='text-sm text-text-muted'>
            欢迎{profileName ? `，${profileName}` : ''}！
          </Text>
        </View>
      )}

      {/* 排练日程标题 + Toggle */}
      {/* 公告（点击查看详情） */}
      {!announcementLoading && announcement?.content ? (
        <View className='mt-4 mb-4' onClick={() => setShowAnnouncementDetail(true)}>
          <View className='flex items-center gap-2 rounded-xl border border-warning-bg bg-warning-bg/80 px-3 py-2'>
            <Text className='shrink-0 text-warning'>📢</Text>
            <View className='min-w-0 flex-1 max-h-[60px] overflow-hidden'>
              <Text className='text-xs leading-relaxed text-warning'>{announcement.content}</Text>
            </View>
          </View>
        </View>
      ) : null}

      <View className='mb-3 mt-1'>
        <PageHeader
          title={scheduleTab === 'history' ? '历史合排' : '本周排练日程'}
          subtitle={scheduleTab === 'history' ? '查看已结束的合排排练' : '查看乐团合排与分排安排'}
        />
        <View className='mt-2'>
          <Toggle
            options={['full', 'section', 'history']}
            value={scheduleTab}
            onChange={(v) => setScheduleTab(v as 'full' | 'section' | 'history')}
            getLabel={(k) => {
              const labels: Record<string, string> = {
                full: '合排',
                section: '分排',
                history: '历史合排',
              }
              return labels[k] ?? k
            }}
          />
        </View>
      </View>

      {/* 排练列表（可滚动） */}
      <View className='flex-1 min-h-0 overflow-y-auto'>
        {rehearsalsLoading ? (
          <Text className='block py-12 text-center text-xs text-text-muted'>加载中…</Text>
        ) : rehearsalsError ? (
          <Card className='border-danger-bg bg-danger-bg/80'>
            <Text className='block px-3 py-2 text-sm text-danger'>加载失败：{rehearsalsError}</Text>
          </Card>
        ) : list.length === 0 ? (
          <Text className='block py-12 text-center text-xs text-text-muted'>暂无安排</Text>
        ) : (
          <View className='space-y-3'>
            {list.map((r) => (
              <RehearsalCard
                key={String(r.id)}
                item={r}
                attendance={attendanceMap[r.id] ?? null}
                attendanceLoading={attendanceLoading}
                isUpdated={isRehearsalUpdated(r) && !isRehearsalEnded(r, new Date(nowTick))}
                leaveRequest={leaveRequestMap[r.id] ?? null}
                onSignIn={() => handleSignIn(r)}
                onClick={() => setDetailRehearsal(r)}
              />
            ))}
          </View>
        )}
      </View>

      {/* 签到码弹窗 */}
      <CodeVerifyModal
        open={!!codeRehearsal}
        title={codeRehearsal?.repertoire ?? ''}
        submitting={codeSubmitting}
        codeInput={codeInput}
        codeError={codeError}
        hint={codeOverrideHint}
        onCodeChange={(v) => {
          setCodeError(null)
          setCodeInput(v)
        }}
        onConfirm={() => void handleCodeConfirm()}
        onClose={handleCodeClose}
      />

      {/* 排练详情弹窗（只读：出勤状态 + 排练信息 + 请假入口） */}
      <RehearsalDetailModal
        item={detailRehearsal}
        attendance={detailRehearsal ? (attendanceMap[detailRehearsal.id] ?? null) : null}
        attendanceLoading={attendanceLoading}
        onRequestLeave={detailRehearsal ? () => setLeaveRehearsal(detailRehearsal) : undefined}
        onClose={() => setDetailRehearsal(null)}
      />

      {/* 请假/补请假面板（叠加在详情弹窗之上） */}
      <LeaveRequestModal
        open={!!leaveRehearsal}
        rehearsal={leaveRehearsal}
        onClose={() => setLeaveRehearsal(null)}
        onSaved={() => {
          if (user?.id && rehearsals) {
            void fetchMyAttendances(
              user.id,
              rehearsals.map((r) => r.id)
            )
          }
        }}
      />

      {/* 公告详情弹窗（顶部公告条点击打开，只读） */}
      <Modal
        open={showAnnouncementDetail}
        onClose={() => setShowAnnouncementDetail(false)}
        title='公告详情'
        position='bottom'
      >
        <View>
          <Text className='mb-3 block text-xs text-text-muted'>
            发布时间：{formatDateTimeInChina(announcement?.created_at ?? null)}
          </Text>
          <View className='max-h-[60vh] overflow-y-auto'>
            <Text className='whitespace-pre-wrap break-words text-sm leading-relaxed text-text'>
              {announcement?.content}
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  )
}
