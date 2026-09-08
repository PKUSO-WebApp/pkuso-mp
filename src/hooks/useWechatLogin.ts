import { useCallback, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { supabase as defaultClient } from '@/lib/supabase'
import { routeAfterLogin } from '@/lib/post-auth-route'

export type WechatLoginResult = { error: string | null }

/**
 * 微信登录（桥接 Edge Function wechat-auth）：
 * 1. Taro.login 获取一次性 code；
 * 2. functions.invoke('wechat-auth')：mode=login → 服务端查找账号
 *    - 用户存在 → 轮换随机密码 → password grant 换 session token 返回
 *    - 用户不存在 → 返回 user_not_found → 前端弹窗引导注册
 * 3. auth.setSession 建立本地会话；
 * 4. 按 profile 状态路由入口。
 */
export function useWechatLogin(client: typeof defaultClient = defaultClient) {
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  const loginWithWechat = useCallback(async (): Promise<WechatLoginResult> => {
    if (submittingRef.current) return { error: '请勿重复提交' }
    submittingRef.current = true
    setSubmitting(true)
    try {
      // 1. wx.login 获取一次性 code
      let code = ''
      try {
        const loginRes = await Taro.login()
        code = loginRes.code ?? ''
      } catch {
        return { error: '微信登录失败，请重试' }
      }
      if (!code) return { error: '微信登录失败，请重试' }

      // 2. Edge Function 桥接：mode=login → 仅查找已有账号，不自动创建
      const { data, error: invokeError } = await client.functions.invoke('wechat-auth', {
        body: { code, mode: 'login' },
      })
      if (invokeError) {
        let message = '微信登录失败，请重试'
        try {
          const ctx = await (
            invokeError as { context?: { json?: () => Promise<{ error?: string }> } }
          ).context?.json?.()
          if (ctx?.error === 'wechat code2session failed') {
            message = '微信登录失败，code 已过期，请重试'
          }
        } catch {
          // 保留默认文案
        }
        return { error: message }
      }

      const payload = data as {
        access_token?: string
        refresh_token?: string
        is_new?: boolean
        error?: string
      } | null

      // user_not_found → 弹窗提示并跳转注册页
      if (payload?.error === 'user_not_found') {
        await Taro.showModal({
          title: '未注册',
          content: '您尚未注册，请先注册账号',
          showCancel: false,
          confirmText: '去注册',
        })
        void Taro.reLaunch({ url: '/pages/register/index' })
        return { error: null }
      }

      if (!payload?.access_token || !payload?.refresh_token) {
        return { error: '微信登录失败，请重试' }
      }

      // 3. 建立本地会话
      const { data: sessionData, error: sessionError } = await client.auth.setSession({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
      })
      if (sessionError || !sessionData?.session?.user?.id) {
        return { error: '微信登录失败，请重试' }
      }

      // 4. 按 profile 状态路由入口
      await routeAfterLogin(client)
      return { error: null }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }, [client])

  return { submitting, loginWithWechat }
}
