import { useEffect } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useThemeClass } from '@/context/theme-context'
import { useUser } from '@/context/user-context'
import { useLogout } from '@/hooks/useLogout'
import { useProfileStatus } from '@/hooks/useProfileStatus'
import { resolveEntryRoute } from '@/lib/profile-gate'

type ApprovalGuardProps = {
  /** 本页对应状态：决定文案与重定向目标（pending → 等待审核，rejected → 审核未通过） */
  expected: 'pending' | 'rejected'
}

const COPY = {
  pending: {
    title: '等待管理员审核',
    desc: '资料已提交，管理员审核通过后即可使用小程序。',
  },
  rejected: {
    title: '审核未通过，请联系管理员',
    desc: '如有疑问请联系乐团管理员。',
  },
}

/**
 * 审核守卫页（等待审核 / 审核未通过两页共用）：
 * - 未登录（会话恢复完成后仍无 user）→ 回登录页；
 * - 状态与本页不符（approved → 首页；另一种非通过状态 → 对应页面）→ 按
 *   resolveEntryRoute 跳转，管理员审核通过后无需用户操作即可进入；
 * - 查询失败且无 profile → 显示错误 + 重试；
 * - 正常显示对应文案 + 刷新状态 + 退出登录。
 */
export function ApprovalGuard({ expected }: ApprovalGuardProps) {
  const { user, ready } = useUser()
  const { signingOut, logout } = useLogout()
  const { profile, loading, error, refresh } = useProfileStatus()
  const darkClass = useThemeClass()

  const expectedPath = expected === 'pending' ? '/pages/pending/index' : '/pages/rejected/index'

  // 状态驱动跳转：profile 到位后按入口路由判定（null 时停留本页等待重试）
  useEffect(() => {
    if (!profile) return
    const target = resolveEntryRoute(profile)
    if (target && target !== expectedPath) {
      void Taro.reLaunch({ url: target })
    }
  }, [profile, expectedPath])

  // 未登录：会话恢复完成后回登录页（本页只应出现在登录后）
  useEffect(() => {
    if (ready && !user) {
      void Taro.reLaunch({ url: '/pages/login/index' })
    }
  }, [ready, user])

  const copy = COPY[expected]

  // 未就绪/未登录时渲染占位，避免跳转前闪烁
  if (!ready || !user) {
    return (
      <View className={`${darkClass} flex h-full items-center justify-center bg-page-bg`}>
        <Text className='text-sm text-text-muted'>加载中…</Text>
      </View>
    )
  }

  return (
    <View
      className={`${darkClass} flex h-full flex-col items-center justify-center gap-4 bg-page-bg px-6 pb-safe`}
    >
      <Text className='text-center text-lg font-semibold text-text'>{copy.title}</Text>
      <Text className='text-center text-sm text-text-muted'>{copy.desc}</Text>

      {/* 首次查询失败：显示错误文案，重试按钮兜底恢复 */}
      {error && !profile ? <Text className='text-center text-sm text-danger'>{error}</Text> : null}

      <View className='mt-2 flex w-full max-w-64 flex-col gap-3'>
        <Button
          hoverClass='none'
          className='flex h-11 w-full items-center justify-center rounded-2xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60'
          disabled={loading || signingOut}
          onClick={() => void refresh()}
        >
          {loading ? '检查中…' : '刷新状态'}
        </Button>
        <Button
          hoverClass='none'
          className='flex h-11 w-full items-center justify-center rounded-2xl bg-muted text-sm font-medium text-text disabled:opacity-60'
          disabled={signingOut}
          onClick={() => void logout()}
        >
          {signingOut ? '退出中…' : '退出登录'}
        </Button>
      </View>
    </View>
  )
}
