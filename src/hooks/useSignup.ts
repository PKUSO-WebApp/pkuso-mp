import { useCallback, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { supabase as defaultClient } from '@/lib/supabase'
import { routeAfterLogin } from '@/lib/post-auth-route'

export type UseSignupResult = {
  email: string
  setEmail: (value: string) => void
  password: string
  setPassword: (value: string) => void
  confirmPassword: string
  setConfirmPassword: (value: string) => void
  fullName: string
  setFullName: (value: string) => void
  submitting: boolean
  errorMsg: string
  handleSubmit: () => Promise<void>
  // 底层注册函数：仅执行 signUp + routeAfterLogin，不管理 submitting
  // 供弹窗等需要独立提交状态的场景使用
  signup: (finalEmail?: string) => Promise<{ needsEmailConfirmation: boolean }>
}

/** 密码最小长度（与 Web 端注册一致） */
const MIN_PASSWORD_LENGTH = 6

// 错误归一化：SDK 透传的 JSON blob/网络异常统一映射为中文文案，不直接透传
export function mapSignupErrorToMessage(error: unknown): string {
  const isErrorLike = (
    value: unknown
  ): value is { message: string; code?: string; status?: number } =>
    typeof value === 'object' && value !== null && 'message' in value
  if (!isErrorLike(error)) {
    return '注册失败，请稍后重试'
  }
  const text = `${error.code ?? ''} ${error.message}`.toLowerCase()
  if (
    text.includes('already registered') ||
    text.includes('user_already_exists') ||
    text.includes('email_exists')
  ) {
    return '该邮箱已被注册，请直接登录'
  }
  if (text.includes('weak') && text.includes('password')) {
    return '密码强度过低，请重新设置'
  }
  if (!text || /fetch|timeout|network|fail/i.test(text)) {
    return '网络异常，请重试'
  }
  return '注册失败，请稍后重试'
}

// 邮箱注册表单逻辑（输入校验/提交/错误处理），页面保持薄。
// 注册成功后：若服务端自动建立会话（关闭邮箱验证）→ 与登录共用 routeAfterLogin，
// 按 profile 状态路由入口（新建用户 status=pending → 等待审核页）；否则需先去邮箱验证。
export function useSignup(client: typeof defaultClient = defaultClient): UseSignupResult {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  // ref 兜底：同一 render 内连续两次点击（state 闭包尚未更新）也只触发一次提交
  const submittingRef = useRef(false)

  /** 底层注册函数：仅执行 signUp + routeAfterLogin，不管理 submitting */
  const signup = useCallback(
    async (finalEmail?: string): Promise<{ needsEmailConfirmation: boolean }> => {
      setErrorMsg('')

      const trimmedEmail = (finalEmail ?? email).trim()
      const trimmedName = fullName.trim()

      if (!trimmedEmail || !password || !confirmPassword || !trimmedName) {
        setErrorMsg('请填写完整信息后再提交。')
        return { needsEmailConfirmation: false }
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        setErrorMsg(`密码长度至少为 ${MIN_PASSWORD_LENGTH} 位，请重新设置。`)
        return { needsEmailConfirmation: false }
      }
      if (password !== confirmPassword) {
        setErrorMsg('两次输入的密码不一致，请重新输入。')
        return { needsEmailConfirmation: false }
      }

      const { data, error } = await client.auth.signUp({
        email: trimmedEmail,
        password,
        options: { data: { full_name: trimmedName } },
      })
      if (error) {
        setErrorMsg(mapSignupErrorToMessage(error))
        return { needsEmailConfirmation: false }
      }
      if (data.session) {
        await routeAfterLogin(client)
        return { needsEmailConfirmation: false }
      }
      return { needsEmailConfirmation: true }
    },
    [email, password, confirmPassword, fullName, client]
  )

  const handleSubmit = useCallback(async () => {
    if (submittingRef.current || submitting) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const { needsEmailConfirmation } = await signup()
      if (needsEmailConfirmation) {
        Taro.showToast({ title: '注册成功，请前往邮箱验证', icon: 'none' })
        setTimeout(() => void Taro.navigateBack(), 1200)
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }, [signup, submitting])

  return {
    email,
    setEmail,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    fullName,
    setFullName,
    submitting,
    errorMsg,
    handleSubmit,
    signup,
  }
}
