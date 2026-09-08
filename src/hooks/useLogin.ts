import { useCallback, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
import { routeAfterLogin } from '@/lib/post-auth-route'
import { useAuth, type AuthErrorLike } from './useAuth'

export type UseLoginResult = {
  email: string
  setEmail: (value: string) => void
  password: string
  setPassword: (value: string) => void
  submitting: boolean
  errorMsg: string
  handleSubmit: () => Promise<void>
}

// 错误归一化：SDK 透传的 JSON blob/网络异常统一映射为中文文案，不直接透传
export function mapAuthErrorToMessage(error: unknown): string {
  const isErrorLike = (value: unknown): value is AuthErrorLike =>
    typeof value === 'object' && value !== null && 'message' in value
  if (!isErrorLike(error)) {
    return '登录失败，请稍后重试'
  }
  const code = error.code?.toLowerCase()
  const status = error.status
  const message = error.message.toLowerCase()
  // 凭据错误：invalid_credentials / 401 / Invalid login credentials
  if (
    code === 'invalid_credentials' ||
    status === 401 ||
    message.includes('invalid login credentials')
  ) {
    return '邮箱或密码错误'
  }
  // 邮箱未确认
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return '邮箱未确认，请先前往邮箱完成确认后再登录'
  }
  // 网络类：无 message 或含 fetch/timeout/network/fail（SDK 弱网/超时常产生这类异常）
  if (!message || /fetch|timeout|network|fail/i.test(message)) {
    return '网络异常，请重试'
  }
  return '登录失败，请稍后重试'
}

// 登录表单逻辑（输入校验/提交/错误处理），页面保持薄。
// 登录成功后与微信登录共用 routeAfterLogin：按 profile 状态路由入口
// （资料补全 / 等待审核 / 审核未通过 / 首页）
export function useLogin(client: typeof defaultClient = defaultClient): UseLoginResult {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  // ref 兜底：同一 render 内连续两次点击（state 闭包尚未更新）也只触发一次提交
  const submittingRef = useRef(false)

  const handleSubmit = useCallback(async () => {
    if (submitting || submittingRef.current) return
    setErrorMsg('')

    if (!email.trim() || !password) {
      setErrorMsg('请输入邮箱和密码。')
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    try {
      const { error } = await signIn(email.trim(), password)
      if (error) {
        setErrorMsg(mapAuthErrorToMessage(error))
        return
      }
      // 按 profile 状态路由入口（tab 页只能用 reLaunch 切换；
      //    RPC 以会话 JWT 的 auth.uid() 为准，无需传 userId）
      await routeAfterLogin(client)
    } catch (err) {
      // 兜底：signIn reject（SDK 网络/超时异常）归一化为中文文案
      setErrorMsg(mapAuthErrorToMessage(err))
    } finally {
      // 无论成败都复位，避免 reject 路径按钮永久「登录中」
      submittingRef.current = false
      setSubmitting(false)
    }
  }, [email, password, submitting, signIn, client])

  return { email, setEmail, password, setPassword, submitting, errorMsg, handleSubmit }
}
