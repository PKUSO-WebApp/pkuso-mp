import { useEffect, useRef, useState } from 'react'
import { Button, Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Card } from '@/components/ui/Card'
import { useThemeClass } from '@/context/theme-context'
import { useUser } from '@/context/user-context'
import { useLogout } from '@/hooks/useLogout'
import { useProfileStatus } from '@/hooks/useProfileStatus'
import { isSyntheticEmail } from '@/lib/profile-gate'
import { routeAfterLogin } from '@/lib/post-auth-route'
import { supabase } from '@/lib/supabase'
import { isValidEmail } from '@/lib/validation'
import './index.scss'

// ============================================================
// 资料补全页状态机（微信登录后 profile 缺姓名/邮箱时路由至此）：
//   [提交] 姓名+邮箱均必填 → 更新 profiles（RLS 仅限本人行，列白名单
//          含 full_name/email）→ 0 行更新视为失败 → 同步 auth 邮箱
//          （updateUser 发确认邮件，与换绑邮箱同流程）→ 重新走入口路由
//          （正常进「等待管理员审核」守卫页）
//   [取消] 登出回登录页（下次微信登录仍会回到本页）
// 双重 guard 防重复提交（ref 同步阻断 + state 异步兜底）。
// ============================================================

/** 姓名最大长度（与 Web 端注册一致） */
const MAX_NAME_LENGTH = 30

/** auth.updateUser 换邮箱错误归一化（主要场景：邮箱已被其他账号注册） */
const mapAuthEmailError = (err: { message?: string; code?: string } | null): string => {
  const text = `${err?.code ?? ''} ${err?.message ?? ''}`.toLowerCase()
  if (text.includes('already been registered') || text.includes('email_exists')) {
    return '该邮箱已被注册，请更换邮箱'
  }
  return '保存失败，请重试'
}

export default function SetupPage() {
  const { user, ready } = useUser()
  const { signingOut, logout } = useLogout()
  const { profile } = useProfileStatus()
  const darkClass = useThemeClass()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const submittingRef = useRef(false)
  // 预填只做一次：已有真实资料带入（合成邮箱视为未填写）
  const prefillRef = useRef(false)

  useEffect(() => {
    if (!profile || prefillRef.current) return
    prefillRef.current = true
    if (profile.full_name?.trim()) setName(profile.full_name)
    if (!isSyntheticEmail(profile.email)) setEmail(profile.email ?? '')
  }, [profile])

  // 未登录：会话恢复完成后回登录页（本页只应出现在登录后）
  useEffect(() => {
    if (ready && !user) {
      void Taro.reLaunch({ url: '/pages/login/index' })
    }
  }, [ready, user])

  const handleSubmit = async () => {
    if (submittingRef.current || submitting || !user) return
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()

    if (!trimmedName) {
      setErrorMsg('请输入姓名')
      return
    }
    if (trimmedName.length > MAX_NAME_LENGTH) {
      setErrorMsg(`姓名过长（最多 ${MAX_NAME_LENGTH} 字）`)
      return
    }
    if (!isValidEmail(trimmedEmail)) {
      setErrorMsg('请输入有效的邮箱地址')
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    setErrorMsg(null)
    try {
      // 0 行更新检测：RLS 静默失败/记录不存在时显式报错
      const { data, error } = await supabase
        .from('profiles')
        .update({ full_name: trimmedName, email: trimmedEmail })
        .eq('id', user.id)
        .select('id')
      if (error || !data || data.length === 0) {
        setErrorMsg('保存失败，请重试')
        return
      }
      // 同步 auth 邮箱（与换绑邮箱同流程：发确认邮件，确认后 auth 才生效）。
      // 显示端以 profiles.email 为准，此步保证长期数据一致；
      // 与当前 auth 邮箱相同则跳过（重试幂等）。失败不静默：邮箱已被注册等场景
      // 给出可操作的文案，用户留在本页换邮箱重试。
      if (trimmedEmail.toLowerCase() !== (user.email ?? '').toLowerCase()) {
        const { error: authError } = await supabase.auth.updateUser({ email: trimmedEmail })
        if (authError) {
          setErrorMsg(mapAuthEmailError(authError))
          return
        }
      }
      void Taro.showToast({ title: '资料已提交，等待管理员审核', icon: 'none' })
      // 重新走入口路由：正常落到「等待管理员审核」守卫页
      await routeAfterLogin(supabase)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

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
      className={`${darkClass} flex h-full flex-col items-center justify-center bg-page-bg px-6 pb-safe`}
    >
      <Card className='w-full px-5 py-6'>
        <View className='mb-4 text-center'>
          <Text className='text-xl font-semibold text-text'>完善资料</Text>
          <Text className='mt-1 block text-xs text-text-muted'>
            姓名与邮箱均为必填，提交后等待管理员审核
          </Text>
        </View>

        <View className='mb-3'>
          <Text className='text-sm font-medium text-text-muted'>姓名</Text>
          <Input
            className='mt-1 h-10 w-full rounded-xl border border-border bg-muted px-3 text-sm text-text'
            placeholder='请输入真实姓名'
            value={name}
            onInput={(e) => {
              setErrorMsg(null)
              setName(e.detail.value)
            }}
          />
        </View>

        <View className='mb-3'>
          <Text className='text-sm font-medium text-text-muted'>邮箱</Text>
          <Input
            className='mt-1 h-10 w-full rounded-xl border border-border bg-muted px-3 text-sm text-text'
            placeholder='name@example.com'
            value={email}
            onInput={(e) => {
              setErrorMsg(null)
              setEmail(e.detail.value)
            }}
          />
        </View>

        {errorMsg ? (
          <View className='mb-3 rounded-xl bg-danger-bg px-3 py-2 text-center text-sm text-danger'>
            {errorMsg}
          </View>
        ) : null}

        {/* 双按钮操作行：右下角（取消 + 提交） */}
        <View className='mt-5 flex justify-end gap-3'>
          <Button
            hoverClass='none'
            className='flex h-10 w-24 items-center justify-center rounded-2xl bg-muted text-sm font-medium text-text disabled:opacity-60'
            disabled={submitting || signingOut}
            onClick={() => void logout()}
          >
            {signingOut ? '取消中…' : '取消'}
          </Button>
          <Button
            hoverClass='none'
            className='flex h-10 w-24 items-center justify-center rounded-2xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60'
            disabled={submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting ? '提交中…' : '提交'}
          </Button>
        </View>
      </Card>
    </View>
  )
}
