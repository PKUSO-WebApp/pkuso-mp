import { useCallback, useRef, useState } from 'react'
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
  // 注册结果：needsEmailConfirmation=true 表示服务端未自动建立会话
  // （邮箱验证开启），用户需先去邮箱确认后才能登录
  handleSubmit: () => Promise<{ needsEmailConfirmation: boolean }>
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

  const handleSubmit = useCallback(async (): Promise<{ needsEmailConfirmation: boolean }> => {
    if (submittingRef.current || submitting) return { needsEmailConfirmation: false }
    setErrorMsg('')

    const trimmedEmail = email.trim()
    const trimmedName = fullName.trim()

    // 本地表单校验：邮箱/密码/确认密码/姓名均必填
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

    submittingRef.current = true
    setSubmitting(true)
    try {
      // options.data.full_name 写入 raw_user_meta_data，handle_new_user 触发器据此
      // 写入 profiles.full_name 并将 status 置为 pending（等待管理员审核）
      const { data, error } = await client.auth.signUp({
        email: trimmedEmail,
        password,
        options: { data: { full_name: trimmedName } },
      })
      if (error) {
        setErrorMsg(mapSignupErrorToMessage(error))
        return { needsEmailConfirmation: false }
      }
      // 注册成功：服务端自动建立会话 → 直接按 profile 状态路由（→ 等待审核页）
      if (data.session) {
        await routeAfterLogin(client)
        return { needsEmailConfirmation: false }
      }
      // 否则（邮箱验证开启）未建立会话，交由页面提示去邮箱确认
      return { needsEmailConfirmation: true }
    } catch (err) {
      // 兜底：signUp reject（SDK 网络/超时异常）归一化为中文文案
      setErrorMsg(mapSignupErrorToMessage(err))
      return { needsEmailConfirmation: false }
    } finally {
      // 无论成败都复位，避免 reject 路径按钮永久「注册中」
      submittingRef.current = false
      setSubmitting(false)
    }
  }, [email, password, confirmPassword, fullName, submitting, client])

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
  }
}
