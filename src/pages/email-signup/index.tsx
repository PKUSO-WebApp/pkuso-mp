import { useEffect, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Card } from '@/components/ui/Card'
import { TextField } from '@/components/ui/FormFields'
import { Modal } from '@/components/ui/Modal'
import { useUser } from '@/context/user-context'
import { useThemeClass } from '@/context/theme-context'
import { useSignup } from '@/hooks/useSignup'
import { useSignupEmailVerify } from '@/hooks/useSignupEmailVerify'
import { useT, useNavTitle } from '@/i18n'
import { routeAfterLogin } from '@/lib/post-auth-route'
import { supabase } from '@/lib/supabase'
import './index.scss'

// ============================================================
// 邮箱注册页：邮箱 + 密码 + 确认密码 + 姓名。
// 注册成功后：服务端自动建立会话 → 直接路由到「等待审核」页；否则提示去邮箱验证。
// ============================================================

export default function EmailSignupPage() {
  const { ready, user } = useUser()
  const {
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
  } = useSignup()
  const emailVerify = useSignupEmailVerify()
  const darkClass = useThemeClass()
  const { t } = useT()
  useNavTitle('emailSignup.navTitle')
  const [agreed, setAgreed] = useState(false)
  const [modalSubmitting, setModalSubmitting] = useState(false)

  useEffect(() => {
    if (!ready || !user) return
    let cancelled = false
    const verifyAndEnter = async () => {
      try {
        await supabase.auth.getUser()
        if (cancelled) return
        await routeAfterLogin(supabase)
      } catch {
        if (!cancelled) void supabase.auth.signOut()
      }
    }
    void verifyAndEnter()
    return () => {
      cancelled = true
    }
  }, [ready, user])

  if (!ready) {
    return (
      <View className={`${darkClass} flex min-h-full items-center justify-center bg-page-bg`}>
        <Text className='text-sm text-text-muted'>{t('common.actions.loading')}</Text>
      </View>
    )
  }

  const onSubmit = async () => {
    if (!agreed) {
      Taro.showToast({ title: t('common.agreement.requiredToast'), icon: 'none' })
      return
    }

    const canProceed = await emailVerify.checkMemberInfo(fullName.trim(), email.trim())
    if (!canProceed) return

    await handleSubmit()
  }

  /** 用户在弹窗中选择「使用记录邮箱」 */
  const handleUseRecorded = async () => {
    const recordedEmail = emailVerify.handleUseRecordedEmail()
    if (recordedEmail) {
      setEmail(recordedEmail)
      setModalSubmitting(true)
      try {
        const { needsEmailConfirmation } = await signup(recordedEmail)
        if (needsEmailConfirmation) {
          Taro.showToast({ title: t('emailSignup.registeredToast'), icon: 'none' })
          setTimeout(() => void Taro.navigateBack(), 1200)
        }
      } finally {
        setModalSubmitting(false)
      }
    }
  }

  /** 用户在弹窗中选择「仍使用该邮箱」→ 直接注册（Supabase 处理邮箱验证） */
  const handleUseOwn = async () => {
    const ownEmail = emailVerify.handleUseOwnEmail()
    setEmail(ownEmail)
    setModalSubmitting(true)
    try {
      const { needsEmailConfirmation } = await signup(ownEmail)
      if (needsEmailConfirmation) {
        Taro.showToast({ title: t('emailSignup.registeredToast'), icon: 'none' })
        setTimeout(() => void Taro.navigateBack(), 1200)
      }
    } finally {
      setModalSubmitting(false)
    }
  }

  return (
    <View
      className={`${darkClass} flex min-h-full flex-col items-center justify-center bg-page-bg px-5`}
    >
      <Card className='w-full px-5 py-6'>
        <TextField
          className='mb-3'
          labelClass='text-sm font-medium text-text-muted'
          label={t('common.fields.fullName')}
          placeholder={t('emailSignup.fullNamePlaceholder')}
          value={fullName}
          onInput={(e) => setFullName(e.detail.value)}
        />

        <TextField
          className='mb-3'
          labelClass='text-sm font-medium text-text-muted'
          label={t('common.fields.email')}
          placeholder='name@example.com'
          value={email}
          onInput={(e) => setEmail(e.detail.value)}
        />

        <TextField
          className='mb-3'
          labelClass='text-sm font-medium text-text-muted'
          label={t('common.fields.password')}
          placeholder={t('emailSignup.passwordPlaceholder')}
          password
          value={password}
          onInput={(e) => setPassword(e.detail.value)}
        />

        <TextField
          className='mb-3'
          labelClass='text-sm font-medium text-text-muted'
          label={t('common.fields.confirmPassword')}
          placeholder={t('emailSignup.confirmPasswordPlaceholder')}
          password
          value={confirmPassword}
          onInput={(e) => setConfirmPassword(e.detail.value)}
        />

        <View className='mb-3 flex items-center' onClick={() => setAgreed((v) => !v)}>
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

        <Button
          hoverClass='none'
          className='flex h-11 w-full items-center justify-center rounded-2xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60'
          disabled={submitting || emailVerify.verifying}
          onClick={() => void onSubmit()}
        >
          {submitting ? t('emailSignup.submitting') : t('emailSignup.submit')}
        </Button>
      </Card>

      {/* 邮箱确认弹窗 */}
      <Modal
        open={emailVerify.showConfirmDialog}
        onClose={emailVerify.handleClose}
        title={t('emailSignup.emailVerify.title')}
        position='center'
      >
        <View className='px-1 py-2'>
          <Text className='text-sm text-text-muted'>{t('emailSignup.emailVerify.desc')}</Text>
          <Text className='mt-2 block text-sm font-medium text-text'>
            {emailVerify.memberInfoEmail}
          </Text>

          {emailVerify.errorMsg ? (
            <View className='mt-3 rounded-xl bg-danger-bg px-3 py-2 text-center text-sm text-danger'>
              {emailVerify.errorMsg}
            </View>
          ) : null}

          <View className='mt-5 flex gap-3'>
            <Button
              hoverClass='none'
              className='flex h-10 flex-1 items-center justify-center rounded-2xl bg-muted text-sm font-medium text-text'
              onClick={() => void handleUseRecorded()}
            >
              {t('emailSignup.emailVerify.useRecorded')}
            </Button>
            <Button
              hoverClass='none'
              className='flex h-10 flex-1 items-center justify-center rounded-2xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60'
              disabled={modalSubmitting}
              onClick={() => void handleUseOwn()}
            >
              {modalSubmitting ? t('emailSignup.submitting') : t('emailSignup.emailVerify.useOwn')}
            </Button>
          </View>
        </View>
      </Modal>
    </View>
  )
}
