import { useEffect } from 'react'
import { Button, Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Card } from '@/components/ui/Card'
import { useUser } from '@/context/user-context'
import { useThemeClass } from '@/context/theme-context'
import { useSignup } from '@/hooks/useSignup'
import { routeAfterLogin } from '@/lib/post-auth-route'
import { supabase } from '@/lib/supabase'
import './index.scss'

// ============================================================
// 邮箱注册页：邮箱 + 密码 + 确认密码 + 姓名（去除邀请码/乐器/学院/入团时间）。
// 注册成功后：服务端自动建立会话 → 直接路由到「等待审核」页；否则提示去邮箱验证。
// 已登录用户（异常进入本页）按 profile 状态路由，避免滞留注册表单。
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
  } = useSignup()
  const darkClass = useThemeClass()

  // 已登录用户（异常进入本页）按 profile 状态路由入口（与注册成功/登录后双触发，幂等）
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
      <View className={`${darkClass} flex h-full items-center justify-center bg-page-bg`}>
        <Text className='text-sm text-text-muted'>加载中…</Text>
      </View>
    )
  }

  const onSubmit = async () => {
    const { needsEmailConfirmation } = await handleSubmit()
    // 邮箱验证开启时未建立会话：提示去邮箱确认后返回上一页登录
    if (needsEmailConfirmation) {
      Taro.showToast({ title: '注册成功，请前往邮箱验证', icon: 'none' })
      setTimeout(() => void Taro.navigateBack(), 1200)
    }
    // 否则 handleSubmit 内已 routeAfterLogin（reLaunch 到等待审核/首页），本页被卸载
  }

  return (
    <View className={`${darkClass} flex h-full flex-col items-center justify-center bg-page-bg px-5`}>
      <Card className='w-full px-5 py-6'>
        <View className='mb-4 text-center'>
          <Text className='text-xl font-semibold text-text'>注册</Text>
          <Text className='mt-1 block text-xs text-text-muted'>创建账号后等待管理员审核</Text>
        </View>

        {/* ✅ 邮箱 */}
        <View className='mb-3'>
          <Text className='text-sm font-medium text-text-muted'>邮箱</Text>
          <View className='mt-1 w-full overflow-hidden rounded-xl border border-border bg-muted px-3'>
            <Input
              className='h-10 w-full bg-transparent text-sm text-text'
              placeholder='name@example.com'
              value={email}
              onInput={(e) => setEmail(e.detail.value)}
            />
          </View>
        </View>

        {/* ✅ 密码 */}
        <View className='mb-3'>
          <Text className='text-sm font-medium text-text-muted'>密码</Text>
          <View className='mt-1 w-full overflow-hidden rounded-xl border border-border bg-muted px-3'>
            <Input
              className='h-10 w-full bg-transparent text-sm text-text'
              placeholder='至少 6 位'
              password
              value={password}
              onInput={(e) => setPassword(e.detail.value)}
            />
          </View>
        </View>

        {/* ✅ 确认密码 */}
        <View className='mb-3'>
          <Text className='text-sm font-medium text-text-muted'>确认密码</Text>
          <View className='mt-1 w-full overflow-hidden rounded-xl border border-border bg-muted px-3'>
            <Input
              className='h-10 w-full bg-transparent text-sm text-text'
              placeholder='再次输入密码'
              password
              value={confirmPassword}
              onInput={(e) => setConfirmPassword(e.detail.value)}
            />
          </View>
        </View>

        {/* ✅ 姓名（去除乐器/学院/入团时间等冗余字段） */}
        <View className='mb-3'>
          <Text className='text-sm font-medium text-text-muted'>姓名</Text>
          <View className='mt-1 w-full overflow-hidden rounded-xl border border-border bg-muted px-3'>
            <Input
              className='h-10 w-full bg-transparent text-sm text-text'
              placeholder='请输入真实姓名'
              value={fullName}
              onInput={(e) => setFullName(e.detail.value)}
            />
          </View>
        </View>

        {errorMsg ? (
          <View className='mb-3 rounded-xl bg-danger-bg px-3 py-2 text-center text-sm text-danger'>
            {errorMsg}
          </View>
        ) : null}

        <Button
          hoverClass='none'
          className='flex h-11 w-full items-center justify-center rounded-2xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60'
          disabled={submitting}
          onClick={() => void onSubmit()}
        >
          {submitting ? '注册中…' : '注册'}
        </Button>
      </Card>

      <View className='mt-4 w-full px-1'>
        <Text
          className='text-sm text-text-muted'
          onClick={() => void Taro.navigateBack()}
        >
          返回
        </Text>
      </View>
    </View>
  )
}
