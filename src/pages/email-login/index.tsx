import { useEffect } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Card } from '@/components/ui/Card'
import { TextField } from '@/components/ui/FormFields'
import { useUser } from '@/context/user-context'
import { useThemeClass } from '@/context/theme-context'
import { useLogin } from '@/hooks/useLogin'
import { useT, useNavTitle } from '@/i18n'
import { routeAfterLogin } from '@/lib/post-auth-route'
import { supabase } from '@/lib/supabase'
import './index.scss'

// ============================================================
// 邮箱登录页（拆分后的第二部分）：邮箱 + 密码登录。
// 顶部「返回微信登录 <」回入口页；底部「使用邮箱注册」路由到邮箱注册页。
// 已登录用户（异常进入本页）按 profile 状态路由，避免滞留登录表单。
// ============================================================

export default function EmailLoginPage() {
  const { ready, user } = useUser()
  const { email, setEmail, password, setPassword, submitting, errorMsg, handleSubmit } = useLogin()
  const darkClass = useThemeClass()
  const { t } = useT()
  useNavTitle('emailLogin.navTitle')

  // 已登录用户（异常进入本页）按 profile 状态路由入口（与登录提交后双触发，幂等）
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

  return (
    <View
      className={`${darkClass} flex min-h-full flex-col items-center justify-center bg-page-bg px-5`}
    >
      <Card className='w-full px-5 py-6'>
        <View className='mb-4 text-center'>
          <Text className='text-xl font-semibold text-text'>{t('emailLogin.title')}</Text>
        </View>

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
          placeholder={t('emailLogin.passwordPlaceholder')}
          password
          value={password}
          onInput={(e) => setPassword(e.detail.value)}
        />

        {errorMsg ? (
          <View className='mb-3 rounded-xl bg-danger-bg px-3 py-2 text-center text-sm text-danger'>
            {errorMsg}
          </View>
        ) : null}

        <Button
          hoverClass='none'
          className='flex h-11 w-full items-center justify-center rounded-2xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60'
          disabled={submitting}
          onClick={() => void handleSubmit()}
        >
          {submitting ? t('emailLogin.submitting') : t('emailLogin.submit')}
        </Button>
      </Card>

      <View className='mt-4 flex w-full items-center justify-between px-1'>
        <Text className='text-sm text-text-muted' onClick={() => void Taro.navigateBack()}>
          {t('emailLogin.backToWechat')}
        </Text>
        <Text
          className='text-sm font-medium text-primary'
          onClick={() => void Taro.navigateTo({ url: '/pages/email-signup/index' })}
        >
          {t('emailLogin.goSignup')}
        </Text>
      </View>
    </View>
  )
}
