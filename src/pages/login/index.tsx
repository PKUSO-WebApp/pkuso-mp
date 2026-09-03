import { useEffect, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Card } from '@/components/ui/Card'
import { ForceOfflineModal } from '@/components/force-offline-modal'
import { useUser } from '@/context/user-context'
import { useThemeClass } from '@/context/theme-context'
import { useWechatLogin } from '@/hooks/useWechatLogin'
import { useT, useNavTitle } from '@/i18n'
import { routeAfterLogin } from '@/lib/post-auth-route'
import { supabase } from '@/lib/supabase'
import './index.scss'

// ============================================================
// 登录入口（拆分后的第一部分）：仅承载两个入口动作——
//   1) 微信授权登录/注册（复用既有 Edge Function 桥接逻辑）
//   2) 路由到「邮箱登录」页（邮箱表单在独立页，符合「登录分两部分」）
// 已登录用户（含冷启动会话恢复后）按 profile 状态路由，避免看到登录页。
// ============================================================

export default function LoginPage() {
  const { ready, user, restoreFailed, forcedOffline, forcedOfflineAt, clearForcedOffline } =
    useUser()
  const { submitting: wechatSubmitting, loginWithWechat } = useWechatLogin()
  const darkClass = useThemeClass()
  const { t } = useT()
  useNavTitle('login.navTitle')

  const [redirecting, setRedirecting] = useState(false)

  // 已登录用户（含冷启动会话恢复后）按 profile 状态路由，避免看到登录页。
  // 先经 getUser 校验会话真实性：storage 有 stale session 但服务端已吊销时
  // （如账号被禁用），静默清除本地会话留在登录页，避免无守卫地跳进首页
  // 若存在 returnTo 参数（分享链接跳转），登录后直接返回原页面
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
        // 会话无效：静默登出清理本地残留，停留登录页
        if (!cancelled) {
          setRedirecting(false)
          void supabase.auth.signOut()
        }
      }
    }
    void verifyAndEnter()
    return () => {
      cancelled = true
    }
  }, [ready, user])

  // 会话恢复或重定向完成前渲染占位，防止登录页闪烁
  const content = !ready || redirecting ? (
    <View className={`${darkClass} flex min-h-full items-center justify-center bg-page-bg`}>
      <Text className='text-sm text-text-muted'>{t('common.actions.loading')}</Text>
    </View>
  ) : (
    <View
      className={`${darkClass} flex min-h-full flex-col items-center justify-center bg-page-bg px-5`}
    >
      <Card className='w-full px-5 py-6'>
        <View className='mb-4 text-center'>
          <Text className='text-xl font-semibold text-text'>{t('login.title')}</Text>
        </View>

        {restoreFailed ? (
          <View className='mb-3 rounded-xl bg-warning-bg px-3 py-2 text-center text-sm text-warning'>
            {t('login.networkError')}
          </View>
        ) : null}

        {/* 微信授权登录/注册：复用既有桥接 Edge Function 的登录逻辑 */}
        <Button
          hoverClass='none'
          className='flex h-11 w-full items-center justify-center rounded-2xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60'
          disabled={wechatSubmitting}
          onClick={() => void loginWithWechat()}
        >
          {wechatSubmitting ? t('login.wechatSubmitting') : t('login.wechatLogin')}
        </Button>

        {/* 邮箱登录/注册：路由到邮箱登录页（邮箱表单在独立页） */}
        <Button
          hoverClass='none'
          className='mt-3 flex h-11 w-full items-center justify-center rounded-2xl bg-muted text-sm font-medium text-text disabled:opacity-60'
          onClick={() => void Taro.navigateTo({ url: '/pages/email-login/index' })}
        >
          {t('login.emailLogin')}
        </Button>
      </Card>
    </View>
  )

  // 被其他设备挤下线：在登录页就地渲染强制下线警告窗（页面内 fixed 浮层，与 Modal 同机制，
  // 确保稳定覆盖在登录页之上）。reLaunch 到登录页后本状态保持为真，弹窗即出现。
  return (
    <>
      <ForceOfflineModal opened={forcedOffline} at={forcedOfflineAt} onClose={clearForcedOffline} />
      {content}
    </>
  )
}
