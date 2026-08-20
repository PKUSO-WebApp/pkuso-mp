import { useEffect } from 'react'
import { Button, Input, Text, View } from '@tarojs/components'
import { Card } from '@/components/ui/Card'
import { useUser } from '@/context/user-context'
import { useThemeClass } from '@/context/theme-context'
import { useLogin } from '@/hooks/useLogin'
import { useWechatLogin } from '@/hooks/useWechatLogin'
import { routeAfterLogin } from '@/lib/post-auth-route'
import { supabase } from '@/lib/supabase'
import './index.scss'

export default function LoginPage() {
  const { ready, user, restoreFailed } = useUser()
  const { email, setEmail, password, setPassword, submitting, errorMsg, handleSubmit } = useLogin()
  const { submitting: wechatSubmitting, loginWithWechat } = useWechatLogin()
  const darkClass = useThemeClass()

  // 已登录用户（含冷启动会话恢复后）按 profile 状态路由，避免看到登录页。
  // 先经 getUser 校验会话真实性：storage 有 stale session 但服务端已吊销时
  // （如账号被禁用），静默清除本地会话留在登录页，避免无守卫地跳进首页
  useEffect(() => {
    if (!ready || !user) return
    let cancelled = false
    const verifyAndEnter = async () => {
      try {
        await supabase.auth.getUser()
        if (cancelled) return
        // 资料补全 / 等待审核 / 审核未通过 / 首页，与提交成功后的路由双触发：幂等，可接受
        await routeAfterLogin(supabase, user.id)
      } catch {
        // 会话无效：静默登出清理本地残留，停留登录页
        if (!cancelled) void supabase.auth.signOut()
      }
    }
    void verifyAndEnter()
    return () => {
      cancelled = true
    }
  }, [ready, user])

  // 会话恢复完成前渲染占位，防止登录页闪烁
  if (!ready) {
    return (
      <View className={`${darkClass} flex h-full items-center justify-center bg-page-bg`}>
        <Text className='text-sm text-text-muted'>加载中…</Text>
      </View>
    )
  }

  return (
    <View
      className={`${darkClass} flex h-full flex-col items-center justify-center bg-page-bg px-5`}
    >
      <Card className='w-full px-5 py-6'>
        <View className='mb-4 text-center'>
          <Text className='text-xl font-semibold text-text'>登录</Text>
          <Text className='mt-1 block text-xs text-text-muted'>登录后进入乐团系统</Text>
        </View>

        {/* 微信登录（桥接 Edge Function wechat-auth）：新用户自动注册，等待管理员审核 */}
        <Button
          hoverClass='none'
          className='flex h-11 w-full items-center justify-center rounded-2xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60'
          disabled={wechatSubmitting}
          onClick={() => void loginWithWechat()}
        >
          {wechatSubmitting ? '登录中…' : '微信登录'}
        </Button>

        {/* 分隔线 */}
        <View className='my-4 flex items-center gap-2'>
          <View className='h-px flex-1 bg-border' />
          <Text className='text-xs text-text-muted'>或使用邮箱登录</Text>
          <View className='h-px flex-1 bg-border' />
        </View>

        {restoreFailed ? (
          <View className='mb-3 rounded-xl bg-warning-bg px-3 py-2 text-center text-sm text-warning'>
            网络异常，请重试
          </View>
        ) : null}

        <View className='mb-3'>
          <Text className='text-sm font-medium text-text-muted'>邮箱</Text>
          <Input
            className='mt-1 h-10 w-full rounded-xl border border-border bg-muted px-3 text-sm text-text'
            placeholder='name@example.com'
            value={email}
            onInput={(e) => setEmail(e.detail.value)}
          />
        </View>

        <View className='mb-3'>
          <Text className='text-sm font-medium text-text-muted'>密码</Text>
          <Input
            className='mt-1 h-10 w-full rounded-xl border border-border bg-muted px-3 text-sm text-text'
            placeholder='请输入密码'
            password
            value={password}
            onInput={(e) => setPassword(e.detail.value)}
          />
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
          onClick={() => void handleSubmit()}
        >
          {submitting ? '登录中…' : '登录'}
        </Button>
      </Card>
    </View>
  )
}
