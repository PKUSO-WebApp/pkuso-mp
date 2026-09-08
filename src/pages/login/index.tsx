import { useEffect, useState } from 'react'
import { Button, Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Card } from '@/components/ui/Card'
import { TextField } from '@/components/ui/FormFields'
import { ForceOfflineModal } from '@/components/force-offline-modal'
import { useUser } from '@/context/user-context'
import { useThemeClass } from '@/context/theme-context'
import { useWechatLogin } from '@/hooks/useWechatLogin'
import { useSendLoginCode } from '@/hooks/useSendLoginCode'
import { useT, useNavTitle } from '@/i18n'
import { routeAfterLogin } from '@/lib/post-auth-route'
import { supabase } from '@/lib/supabase'
import './index.scss'

type LoginMode = 'code' | 'password'

export default function LoginPage() {
  const { ready, user, restoreFailed, forcedOffline, forcedOfflineAt, clearForcedOffline } =
    useUser()
  const { submitting: wechatSubmitting, loginWithWechat } = useWechatLogin()
  const { sending: codeSending, countdown, isCountingDown, sendCode } = useSendLoginCode()
  const darkClass = useThemeClass()
  const { t } = useT()
  useNavTitle('login.navTitle')

  const [redirecting, setRedirecting] = useState(false)
  const [mode, setMode] = useState<LoginMode>('code')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!ready || !user) return
    const returnTo = Taro.getCurrentInstance().router?.params?.returnTo
    let cancelled = false
    setRedirecting(true)
    const verifyAndEnter = async () => {
      try {
        await supabase.auth.getUser()
        if (cancelled) return
        if (returnTo) {
          await Taro.reLaunch({ url: decodeURIComponent(returnTo) })
        } else {
          await routeAfterLogin(supabase)
        }
      } catch {
        if (!cancelled) {
          setRedirecting(false)
          void supabase.auth.signOut()
        }
      }
    }
    void verifyAndEnter()
    return () => { cancelled = true }
  }, [ready, user])

  const handleSendCode = async () => {
    if (!email.trim()) {
      setErrorMsg('请输入邮箱')
      return
    }
    setErrorMsg('')
    const result = await sendCode(email)
    if (result.success) {
      Taro.showToast({ title: t('login.codeSendSuccess'), icon: 'none' })
    } else {
      setErrorMsg(t('login.codeSendFailed'))
    }
  }

  const handleCodeLogin = async () => {
    if (submitting) return
    if (!email.trim() || !code.trim()) {
      setErrorMsg('请输入邮箱和验证码')
      return
    }
    setSubmitting(true)
    setErrorMsg('')
    try {
      // 先检查用户是否存在（通过 profiles 表）
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email.trim().toLowerCase())
        .maybeSingle()

      if (!profile) {
        setErrorMsg(t('login.userNotRegistered'))
        return
      }

      // 调用 login-with-code Edge Function 验证验证码并获取 session
      const { data, error } = await supabase.functions.invoke('login-with-code', {
        body: {
          email: email.trim().toLowerCase(),
          code: code.trim(),
        },
      })

      if (error || data?.error) {
        setErrorMsg('验证码错误或已过期')
        return
      }

      if (data?.access_token && data?.refresh_token) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        })
        if (sessionError) {
          setErrorMsg(t('login.loginFailed'))
          return
        }
        await routeAfterLogin(supabase)
      } else {
        setErrorMsg(t('login.loginFailed'))
      }
    } catch {
      setErrorMsg(t('login.loginFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const handlePasswordLogin = async () => {
    if (submitting) return
    if (!email.trim() || !password) {
      setErrorMsg('请输入邮箱和密码')
      return
    }
    setSubmitting(true)
    setErrorMsg('')
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (error) {
        const errCode = error.code?.toLowerCase()
        if (errCode === 'invalid_credentials' || error.status === 401) {
          setErrorMsg('邮箱或密码错误')
        } else if (errCode === 'email_not_confirmed') {
          setErrorMsg('邮箱未确认')
        } else {
          setErrorMsg('登录失败，请稍后重试')
        }
        return
      }
      await routeAfterLogin(supabase)
    } catch {
      setErrorMsg('网络异常，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = () => {
    if (mode === 'code') {
      void handleCodeLogin()
    } else {
      void handlePasswordLogin()
    }
  }

  const switchMode = () => {
    setMode((prev) => (prev === 'code' ? 'password' : 'code'))
    setErrorMsg('')
    setCode('')
    setPassword('')
  }

  const content = !ready || redirecting ? (
    <View className={`${darkClass} flex min-h-full items-center justify-center bg-page-bg`}>
      <Text className='text-sm text-text-muted'>{t('common.actions.loading')}</Text>
    </View>
  ) : (
    <View className={`${darkClass} flex min-h-full flex-col items-center justify-center bg-page-bg px-5`}>
      <Card className='w-full px-5 py-6'>
        <View className='mb-4 text-center'>
          <Text className='text-xl font-semibold text-text'>{t('login.title')}</Text>
        </View>

        {restoreFailed ? (
          <View className='mb-3 rounded-xl bg-warning-bg px-3 py-2 text-center text-sm text-warning'>
            {t('login.networkError')}
          </View>
        ) : null}

        {/* 微信授权登录 */}
        <Button
          hoverClass='none'
          className='flex h-11 w-full items-center justify-center rounded-2xl bg-[#03DB6C] text-sm font-medium text-white disabled:opacity-60'
          disabled={wechatSubmitting}
          onClick={() => void loginWithWechat()}
        >
          {wechatSubmitting ? t('login.wechatSubmitting') : t('login.wechatLogin')}
        </Button>

        {/* 分隔线 */}
        <View className='my-6 flex items-center gap-3'>
          <View className='h-px flex-1 bg-border' />
          <Text className='text-xs text-text-muted'>{t('login.or')}</Text>
          <View className='h-px flex-1 bg-border' />
        </View>

        {/* 邮箱输入 */}
        <TextField
          className='mb-3'
          labelClass='text-sm font-medium text-text-muted'
          label={t('login.emailLabel')}
          placeholder='name@example.com'
          value={email}
          onInput={(e) => { setErrorMsg(''); setEmail(e.detail.value) }}
        />

        {/* 验证码模式 */}
        {mode === 'code' ? (
          <>
            <View className='mb-3'>
              <Text className='mb-1 block text-sm font-medium text-text-muted'>{t('login.codeLabel')}</Text>
              <View className='flex items-center gap-2'>
                <View className='flex-1 overflow-hidden rounded-xl border border-border bg-muted px-3'>
                  <Input
                    className='h-10 w-full bg-transparent text-sm'
                    placeholder={t('login.codePlaceholder')}
                    type='number'
                    maxlength={6}
                    value={code}
                    onInput={(e) => { setErrorMsg(''); setCode(e.detail.value) }}
                  />
                </View>
                <View
                  className={`flex-shrink-0 rounded-xl px-3 py-2 text-xs font-medium ${
                    isCountingDown || codeSending
                      ? 'bg-muted text-text-muted'
                      : 'bg-primary text-primary-foreground'
                  }`}
                  onClick={isCountingDown || codeSending ? undefined : () => void handleSendCode()}
                >
                  {codeSending
                    ? '...'
                    : isCountingDown
                      ? t('login.resendCode', { seconds: countdown })
                      : t('login.getCode')}
                </View>
              </View>
            </View>
          </>
        ) : (
          <TextField
            className='mb-3'
            labelClass='text-sm font-medium text-text-muted'
            label={t('login.passwordLabel')}
            placeholder={t('login.passwordPlaceholder')}
            password
            value={password}
            onInput={(e) => { setErrorMsg(''); setPassword(e.detail.value) }}
          />
        )}

        {errorMsg ? (
          <View className='mb-3 rounded-xl bg-danger-bg px-3 py-2 text-center text-sm text-danger'>
            {errorMsg}
          </View>
        ) : null}

        {/* 登录按钮 */}
        <Button
          hoverClass='none'
          className='flex h-11 w-full items-center justify-center rounded-2xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60'
          disabled={submitting || (mode === 'code' && codeSending)}
          onClick={() => void handleSubmit()}
        >
          {submitting ? t('login.loggingIn') : t('login.login')}
        </Button>

        {/* 切换登录方式 + 注册入口 */}
        <View className='mt-4 flex items-center justify-between px-1'>
          <Text
            className='text-sm font-medium text-primary'
            onClick={switchMode}
          >
            {mode === 'code' ? t('login.switchToPassword') : t('login.switchToCode')}
          </Text>
          <Text className='text-sm text-text-muted'>
            {t('login.noAccount')}{' '}
            <Text
              className='font-medium text-primary'
              onClick={() => void Taro.reLaunch({ url: '/pages/register/index' })}
            >
              {t('login.register')}
            </Text>
          </Text>
        </View>
      </Card>
    </View>
  )

  return (
    <>
      <ForceOfflineModal opened={forcedOffline} at={forcedOfflineAt} onClose={clearForcedOffline} />
      {content}
    </>
  )
}
