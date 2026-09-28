import { useEffect, useRef, useState } from 'react'
import { Button, Input, Text, View } from '@tarojs/components'
import { TextField } from '@/components/ui/FormFields'
import Taro from '@tarojs/taro'
import { Card } from '@/components/ui/Card'
import { ActionBar } from '@/components/ui/ActionBar'
import { Modal } from '@/components/ui/Modal'
import { useThemeClass } from '@/context/theme-context'
import { useUser } from '@/context/user-context'
import { useLogout } from '@/hooks/useLogout'
import { useProfileStatus } from '@/hooks/useProfileStatus'
import { useSignupEmailVerify } from '@/hooks/useSignupEmailVerify'
import { useCountdown } from '@/hooks/useCountdown'
import { isSyntheticEmail } from '@/lib/profile-gate'
import { routeAfterLogin } from '@/lib/post-auth-route'
import { supabase } from '@/lib/supabase'
import { invokeFunction } from '@/lib/functions'
import { isValidEmail } from '@/lib/validation'
import { useT, useNavTitle } from '@/i18n'
import './index.scss'

// ============================================================
// 资料补全页状态机（微信登录后 profile 缺姓名/邮箱时路由至此）：
//   [提交] 姓名+邮箱均必填 → 查询 member_info 检查邮箱一致性 →
//          如不一致弹窗确认 → 用户选择后更新 profiles → 同步 auth 邮箱 →
//          重新走入口路由（正常进「等待管理员审核」守卫页）
//   [取消] 登出回登录页（下次微信登录仍会回到本页）
// 双重 guard 防重复提交（ref 同步阻断 + state 异步兜底）。
// ============================================================

/** 姓名最大长度（与 Web 端注册一致） */
const MAX_NAME_LENGTH = 30

/** auth.updateUser 换邮箱错误归一化（主要场景：邮箱已被其他账号注册） */
const mapAuthEmailError = (
  t: (k: string, p?: Record<string, unknown>) => string,
  err: { message?: string; code?: string } | null
): string => {
  const text = `${err?.code ?? ''} ${err?.message ?? ''}`.toLowerCase()
  if (text.includes('already been registered') || text.includes('email_exists')) {
    return t('setup.authEmail.alreadyRegistered')
  }
  return t('setup.authEmail.saveFailed')
}

export default function SetupPage() {
  const { user, ready } = useUser()
  const { signingOut, logout } = useLogout()
  const { profile } = useProfileStatus()
  const darkClass = useThemeClass()
  const { t } = useT()
  useNavTitle('setup.navTitle')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const prefillRef = useRef(false)

  const emailVerify = useSignupEmailVerify()

  // 邮箱验证：验证码状态（复用现有 send-verification-code + verify-and-update）
  const [codeSending, setCodeSending] = useState(false)
  const [codeSent, setCodeSent] = useState(false)
  const [codeVerifying, setCodeVerifying] = useState(false)
  const [verifyCode, setVerifyCode] = useState('')
  const [modalErrorMsg, setModalErrorMsg] = useState<string | null>(null)
  // 重发冷却：定时器与归零都交给 hook（原本手写 setInterval + 一个专门的卸载清理 effect）
  const {
    countdown: codeCountdown,
    start: startCodeCountdown,
    stop: stopCodeCountdown,
  } = useCountdown(60)

  useEffect(() => {
    if (!profile || prefillRef.current) return
    prefillRef.current = true
    if (profile.full_name?.trim()) setName(profile.full_name)
    if (!isSyntheticEmail(profile.email)) setEmail(profile.email ?? '')
  }, [profile])

  useEffect(() => {
    if (ready && !user) {
      void Taro.reLaunch({ url: '/pages/login/index' })
    }
  }, [ready, user])

  /** 实际提交资料到 profiles */
  const doSubmit = async (finalEmail: string) => {
    if (!user) return
    const trimmedName = name.trim()
    submittingRef.current = true
    setSubmitting(true)
    setErrorMsg(null)
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({ full_name: trimmedName, email: finalEmail })
        .eq('id', user.id)
        .select('id')
      if (error || !data || data.length === 0) {
        setErrorMsg(t('setup.errors.saveFailed'))
        return
      }
      if (finalEmail.toLowerCase() !== (user.email ?? '').toLowerCase()) {
        const { error: authError } = await supabase.auth.updateUser({ email: finalEmail })
        if (authError) {
          setErrorMsg(mapAuthEmailError(t, authError))
          return
        }
      }
      void Taro.showToast({ title: t('setup.toastSubmitted'), icon: 'none' })
      await routeAfterLogin(supabase)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  /** 调用现有 send-verification-code 发送验证码 */
  const sendVerificationCode = async (newEmail: string) => {
    setCodeSending(true)
    setModalErrorMsg(null)
    try {
      const { data, error } = await invokeFunction(supabase, 'send-verification-code', {
        body: { purpose: 'email_change', new_email: newEmail },
      })
      if (error || data?.error) {
        setModalErrorMsg(t('setup.emailVerify.sendFailed'))
        return
      }
      setCodeSent(true)
      startCodeCountdown()
    } catch (err) {
      console.error('[setup] send code error', err)
      setModalErrorMsg(t('setup.emailVerify.sendFailed'))
    } finally {
      setCodeSending(false)
    }
  }

  /** 调用现有 verify-and-update 验证验证码 */
  const verifyAndUpdate = async (newEmail: string): Promise<boolean> => {
    if (!verifyCode.trim() || verifyCode.trim().length !== 6) {
      setModalErrorMsg(t('setup.emailVerify.codeInvalid'))
      return false
    }
    setCodeVerifying(true)
    setModalErrorMsg(null)
    try {
      const { data, error } = await invokeFunction(supabase, 'verify-and-update', {
        body: { purpose: 'email_change', code: verifyCode.trim(), new_email: newEmail },
      })
      if (error || data?.error) {
        const errMsg = (data?.error as string) ?? error?.message ?? ''
        if (errMsg.includes('expired')) {
          setModalErrorMsg(t('setup.emailVerify.codeExpired'))
        } else if (errMsg.includes('mismatch') || errMsg.includes('code')) {
          setModalErrorMsg(t('setup.emailVerify.codeInvalid'))
        } else {
          setModalErrorMsg(t('setup.emailVerify.codeInvalid'))
        }
        return false
      }
      stopCodeCountdown()
      setCodeSent(false)
      setVerifyCode('')
      return true
    } catch (err) {
      console.error('[setup] verify error', err)
      setModalErrorMsg(t('setup.emailVerify.codeInvalid'))
      return false
    } finally {
      setCodeVerifying(false)
    }
  }

  const handleSubmit = async () => {
    if (submittingRef.current || submitting || !user) return
    if (!agreed) {
      void Taro.showToast({ title: t('common.agreement.requiredToast'), icon: 'none' })
      return
    }
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()

    if (!trimmedName) {
      setErrorMsg(t('setup.errors.nameRequired'))
      return
    }
    if (trimmedName.length > MAX_NAME_LENGTH) {
      setErrorMsg(t('setup.errors.nameTooLong', { max: MAX_NAME_LENGTH }))
      return
    }
    if (!isValidEmail(trimmedEmail)) {
      setErrorMsg(t('setup.errors.emailInvalid'))
      return
    }

    const canProceed = await emailVerify.checkMemberInfo(trimmedName, trimmedEmail)
    if (!canProceed) return

    await doSubmit(trimmedEmail)
  }

  /** 用户在弹窗中选择「使用记录邮箱」 */
  const handleUseRecorded = async () => {
    const recordedEmail = emailVerify.handleUseRecordedEmail()
    if (recordedEmail) {
      setEmail(recordedEmail)
      await doSubmit(recordedEmail)
    }
  }

  /** 用户在弹窗中选择「仍使用该邮箱」→ 发送验证码 */
  const handleUseOwn = () => {
    const ownEmail = emailVerify.handleUseOwnEmail()
    void sendVerificationCode(ownEmail)
  }

  /** 用户输入验证码后确认 */
  const handleVerifyConfirm = async () => {
    const ownEmail = email.trim()
    const ok = await verifyAndUpdate(ownEmail)
    if (ok) {
      handleClose()
      await doSubmit(ownEmail)
    }
  }

  /** 重发验证码 */
  const handleResendCode = () => {
    void sendVerificationCode(email.trim())
  }

  /** 关闭弹窗时重置验证码状态 */
  const handleClose = () => {
    emailVerify.handleClose()
    setCodeSent(false)
    stopCodeCountdown()
    setVerifyCode('')
    setModalErrorMsg(null)
  }

  if (!ready || !user) {
    return (
      <View className={`${darkClass} flex min-h-full items-center justify-center bg-page-bg`}>
        <Text className='text-sm text-text-muted'>{t('common.actions.loading')}</Text>
      </View>
    )
  }

  return (
    <View
      className={`${darkClass} flex min-h-full flex-col items-center justify-center bg-page-bg px-6 pb-safe`}
    >
      <Card className='w-full px-5 py-6'>
        <View className='mb-4 text-center'>
          <Text className='text-xl font-semibold text-text'>{t('setup.title')}</Text>
        </View>

        <TextField
          className='mb-3'
          labelClass='text-sm font-medium text-text-muted'
          label={t('setup.nameLabel')}
          inputClass='h-10 text-sm text-text'
          placeholder={t('setup.namePlaceholder')}
          value={name}
          onInput={(e) => {
            setErrorMsg(null)
            setName(e.detail.value)
          }}
        />

        <TextField
          className='mb-3'
          labelClass='text-sm font-medium text-text-muted'
          label={t('setup.emailLabel')}
          inputClass='h-10 text-sm text-text'
          placeholder={t('setup.emailPlaceholder')}
          value={email}
          onInput={(e) => {
            setErrorMsg(null)
            setEmail(e.detail.value)
          }}
        />

        <View
          className='mb-3 flex items-center'
          onClick={() => {
            setErrorMsg(null)
            setAgreed((v) => !v)
          }}
        >
          <View
            className={`mr-2 flex h-5 w-5 items-center justify-center rounded border ${
              agreed ? 'border-primary bg-primary' : 'border-border bg-page-bg'
            }`}
          >
            {agreed ? <Text className='text-xs text-primary-foreground'>✓</Text> : null}
          </View>
          <Text className='text-sm text-text-muted'>{t('common.agreement.checkbox')}</Text>
          <Text
            className='text-sm text-primary'
            onClick={(e) => {
              e.stopPropagation()
              void Taro.navigateTo({ url: '/pages/agreement/index' })
            }}
          >
            {t('common.agreement.linkText')}
          </Text>
        </View>

        {errorMsg ? (
          <View className='mb-3 rounded-xl bg-danger-bg px-3 py-2 text-center text-sm text-danger'>
            {errorMsg}
          </View>
        ) : null}

        <ActionBar className='mt-5 gap-3'>
          <Button
            hoverClass='none'
            className='flex h-10 w-24 items-center justify-center rounded-2xl bg-muted text-sm font-medium text-text disabled:opacity-60'
            disabled={submitting || signingOut}
            onClick={() => void logout()}
          >
            {signingOut ? t('setup.canceling') : t('setup.cancel')}
          </Button>
          <Button
            hoverClass='none'
            className='flex h-10 w-24 items-center justify-center rounded-2xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60'
            disabled={submitting || emailVerify.verifying}
            onClick={() => void handleSubmit()}
          >
            {submitting ? t('setup.submitting') : t('setup.submit')}
          </Button>
        </ActionBar>
      </Card>

      {/* 邮箱确认弹窗 */}
      <Modal
        open={emailVerify.showConfirmDialog}
        onClose={handleClose}
        title={t('setup.emailVerify.title')}
        position='center'
      >
        <View className='px-1 py-2'>
          <Text className='text-sm text-text-muted'>{t('setup.emailVerify.desc')}</Text>
          <Text className='mt-2 block text-sm font-medium text-text'>
            {emailVerify.memberInfoEmail}
          </Text>

          {/* 验证码输入区域（inline：输入框 + 发送按钮） */}
          {codeSent ? (
            <View className='mt-4'>
              <Text className='mb-1 block text-xs font-medium text-text-muted'>
                {t('setup.emailVerify.codeSent', { email: email.trim() })}
              </Text>
              <View className='flex items-center gap-2'>
                <View className='flex-1 overflow-hidden rounded-xl border border-border bg-muted px-3'>
                  <Input
                    className='h-10 w-full bg-transparent text-sm text-text'
                    placeholder={t('setup.emailVerify.codePlaceholder')}
                    type='number'
                    maxlength={6}
                    value={verifyCode}
                    onInput={(e) => setVerifyCode(e.detail.value)}
                  />
                </View>
                <View
                  className={`flex-shrink-0 rounded-xl px-3 py-2 text-xs font-medium ${
                    codeCountdown > 0 || codeSending
                      ? 'bg-muted text-text-muted'
                      : 'bg-primary text-primary-foreground'
                  }`}
                  onClick={codeCountdown > 0 || codeSending ? undefined : handleResendCode}
                >
                  {codeSending
                    ? t('setup.emailVerify.verifying')
                    : codeCountdown > 0
                      ? t('setup.emailVerify.resendCode', { seconds: codeCountdown })
                      : t('setup.emailVerify.sendCode')}
                </View>
              </View>
            </View>
          ) : null}

          {modalErrorMsg ? (
            <View className='mt-3 rounded-xl bg-danger-bg px-3 py-2 text-center text-sm text-danger'>
              {modalErrorMsg}
            </View>
          ) : null}

          {/* 操作按钮 */}
          {!codeSent ? (
            <View className='mt-5 flex gap-3'>
              <Button
                hoverClass='none'
                className='flex h-10 flex-1 items-center justify-center rounded-2xl bg-muted text-sm font-medium text-text'
                onClick={handleUseRecorded}
              >
                {t('setup.emailVerify.useRecorded')}
              </Button>
              <Button
                hoverClass='none'
                className='flex h-10 flex-1 items-center justify-center rounded-2xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60'
                disabled={codeSending}
                onClick={handleUseOwn}
              >
                {codeSending ? t('setup.emailVerify.verifying') : t('setup.emailVerify.useOwn')}
              </Button>
            </View>
          ) : (
            <View className='mt-4 flex justify-end'>
              <View
                className={`rounded-full bg-primary px-6 py-2 text-xs font-medium text-primary-foreground ${
                  codeVerifying || verifyCode.length !== 6 ? 'opacity-60' : ''
                }`}
                onClick={
                  codeVerifying || verifyCode.length !== 6
                    ? undefined
                    : () => void handleVerifyConfirm()
                }
              >
                {codeVerifying ? t('setup.emailVerify.verifying') : t('common.actions.confirm')}
              </View>
            </View>
          )}
        </View>
      </Modal>
    </View>
  )
}
