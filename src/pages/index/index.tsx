import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useRehearsals } from '@/hooks/useRehearsals'
import { useAttendance } from '@/hooks/useAttendance'
import { useMyProfile } from '@/hooks/useMyProfile'
import { useUser } from '@/context/user-context'
import { Toggle } from '@/components/ui/Toggle'
import { Card } from '@/components/ui/Card'
import { AdminBlockedPage } from '@/components/admin-blocked-page'
import { isRehearsalWithinNextWeek } from '@/lib/rehearsal-utils'
import { isRehearsalUpdated, isRehearsalEnded, sortRehearsalsForMember } from '@/lib/rehearsal-sort'
import type { RehearsalRow } from '@/types/database'
import { RehearsalCard } from './components/rehearsal-card'
import { CodeVerifyModal } from './components/code-verify-modal'
import './index.scss'

export default function Index() {
  const { data: rehearsals, loading: rehearsalsLoading, error: rehearsalsError } = useRehearsals()
  const { user } = useUser()
  const {
    map: attendanceMap,
    loading: attendanceLoading,
    fetchMyAttendances,
    signIn,
  } = useAttendance()
  const { profile: myProfile } = useMyProfile()

  const profileName = myProfile?.full_name ?? null

  const [scheduleTab, setScheduleTab] = useState<'full' | 'section'>('full')
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
    const filtered = rehearsals.filter(
      (r) => r.type === scheduleTab && isRehearsalWithinNextWeek(r.start_time, now)
    )
    return sortRehearsalsForMember(filtered, now)
  }, [rehearsals, scheduleTab, nowTick])

  // 签到按钮点击：合排有签到码 → 弹出签到码弹窗；分排无签到码 → 暂不支持
  const handleSignIn = (rehearsal: RehearsalRow) => {
    if (!user) return
    if (rehearsal.sign_in_code) {
      setCodeRehearsal(rehearsal)
      setCodeInput('')
      setCodeError(null)
    } else {
      void Taro.showToast({ title: '该排练未配置签到码', icon: 'none' })
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
      const err = await signIn({
        rehearsal_id: codeRehearsal.id,
        code: codeInput,
      })
      if (!err) {
        void Taro.showToast({ title: '签到成功', icon: 'success' })
        setCodeRehearsal(null)
        // 刷新考勤 map
        const ids = rehearsals.map((r) => r.id)
        await fetchMyAttendances(user.id, ids)
      } else {
        // 错误归一化中文文案
        const msg = err.toLowerCase().includes('invalid sign-in code')
          ? '签到码错误'
          : err.toLowerCase().includes('authentication required')
            ? '请先登录'
            : err.toLowerCase().includes('not approved')
              ? '账号未通过审核'
              : err.toLowerCase().includes('outside the allowed window')
                ? '不在签到时间窗口内'
                : err.toLowerCase().includes('already been signed')
                  ? '已签到，不可重复签到'
                  : '签到失败'
        setCodeError(msg)
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
    <View className='flex h-full min-h-0 flex-col bg-page-bg px-4 pb-safe'>
      {/* 欢迎语（5 秒后淡出消失） */}
      {user && welcomeMounted && (
        <View
          className={`mb-4 transition-opacity duration-500 ${
            welcomeVisible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <Text className='text-sm text-text-muted'>
            欢迎{profileName ? `，${profileName}` : ''}！
          </Text>
        </View>
      )}

      {/* 排练日程标题 + Toggle */}
      <View className='mb-3'>
        <View className='flex items-center justify-between'>
          <View>
            <Text className='text-lg font-semibold text-text'>本周排练日程</Text>
            <Text className='mt-1 block text-xs text-text-muted'>查看乐团合排与分排安排</Text>
          </View>
        </View>
        <View className='mt-2'>
          <Toggle
            options={['full', 'section']}
            value={scheduleTab}
            onChange={(v) => setScheduleTab(v as 'full' | 'section')}
            getLabel={(k) => {
              const labels: Record<string, string> = { full: '合排', section: '分排' }
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
                onSignIn={() => handleSignIn(r)}
                hasCode={!!r.sign_in_code}
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
        onCodeChange={(v) => {
          setCodeError(null)
          setCodeInput(v)
        }}
        onConfirm={() => void handleCodeConfirm()}
        onClose={handleCodeClose}
      />
    </View>
  )
}
