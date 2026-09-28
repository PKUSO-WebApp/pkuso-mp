import { useCallback, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { invokeFunction } from '@/lib/functions'

type MemberInfoCheckResult = {
  found: boolean
  email: string | null
}

type UseSignupEmailVerifyReturn = {
  /** 是否正在进行 member_info 检查 */
  verifying: boolean
  /** 是否显示确认弹窗 */
  showConfirmDialog: boolean
  /** member_info 中记录的邮箱 */
  memberInfoEmail: string | null
  /** 错误信息 */
  errorMsg: string | null
  /** 检查 member_info 并决定是否弹窗 */
  checkMemberInfo: (fullName: string, email: string) => Promise<boolean>
  /** 用户选择使用记录邮箱 → 返回记录邮箱 */
  handleUseRecordedEmail: () => string
  /** 用户选择使用自己的邮箱 → 返回用户输入的邮箱 */
  handleUseOwnEmail: () => string
  /** 关闭弹窗，重置状态 */
  handleClose: () => void
}

/**
 * 注册时 member_info 邮箱一致性检查 hook
 *
 * 流程：
 * 1. checkMemberInfo：查询 member_info，如果姓名匹配且邮箱不一致 → 弹窗
 * 2. handleUseRecordedEmail：用户选择使用记录邮箱 → 返回记录邮箱
 * 3. handleUseOwnEmail：用户选择使用自己的邮箱 → 返回用户邮箱
 *
 * 验证码逻辑由调用方处理（setup 页面复用现有 send-verification-code + verify-and-update；
 * email-signup 页面直接注册，Supabase 自动处理邮箱验证）
 */
export function useSignupEmailVerify(): UseSignupEmailVerifyReturn {
  const [verifying, setVerifying] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [memberInfoEmail, setMemberInfoEmail] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const currentEmailRef = useRef('')

  const checkMemberInfo = useCallback(async (fullName: string, email: string): Promise<boolean> => {
    if (!fullName.trim() || !email.trim()) return true

    setVerifying(true)
    setErrorMsg(null)
    try {
      const { data, error } = await invokeFunction(supabase, 'check-member-info', {
        body: { full_name: fullName.trim() },
      })

      if (error || data?.error) {
        console.error('[useSignupEmailVerify] check error', error ?? data?.error)
        return true
      }

      const result = data as MemberInfoCheckResult
      if (!result.found || !result.email) return true

      const recordEmail = result.email.trim().toLowerCase()
      const inputEmail = email.trim().toLowerCase()

      if (recordEmail === inputEmail) return true

      currentEmailRef.current = email.trim()
      setMemberInfoEmail(result.email.trim())
      setShowConfirmDialog(true)
      return false
    } catch (err) {
      console.error('[useSignupEmailVerify] check exception', err)
      return true
    } finally {
      setVerifying(false)
    }
  }, [])

  const handleUseRecordedEmail = useCallback((): string => {
    setShowConfirmDialog(false)
    const recordedEmail = memberInfoEmail ?? ''
    currentEmailRef.current = recordedEmail
    return recordedEmail
  }, [memberInfoEmail])

  const handleUseOwnEmail = useCallback((): string => {
    // 不关闭弹窗——由调用方控制弹窗切换到验证码输入视图
    return currentEmailRef.current
  }, [])

  const handleClose = useCallback(() => {
    setShowConfirmDialog(false)
    setMemberInfoEmail(null)
    setErrorMsg(null)
  }, [])

  return {
    verifying,
    showConfirmDialog,
    memberInfoEmail,
    errorMsg,
    checkMemberInfo,
    handleUseRecordedEmail,
    handleUseOwnEmail,
    handleClose,
  }
}
