import { useCallback, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { supabase as defaultClient } from '@/lib/supabase'
import { routeAfterLogin } from '@/lib/post-auth-route'

export type WechatLoginResult = { error: string | null }

/**
 * 微信登录（桥接 Edge Function wechat-auth，规划 §6）：
 * 1. Taro.login 获取一次性 code；
 * 2. functions.invoke('wechat-auth')：服务端 code2session 换 openid → 找/建账号
 *    → 轮换随机密码 → password grant 换 session token 返回；
 * 3. auth.setSession 建立本地会话；
 * 4. 按 profile 状态路由入口（routeAfterLogin 统一处理）：
 *    资料不完整 → 资料补全页；pending → 等待审核；rejected → 审核未通过；
 *    approved → 首页。新注册用户因 full_name 为空自然落到补全页。
 * 双重 guard 防重复提交（ref 同步阻断 + state 异步兜底）。
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

      // 2. Edge Function 桥接：code → openid → Supabase session token
      const { data, error: invokeError } = await client.functions.invoke('wechat-auth', {
        body: { code },
      })
      if (invokeError) {
        // FunctionsHttpError 带响应体上下文（函数返回的 { error, detail }）
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
      } | null
      if (!payload?.access_token || !payload?.refresh_token) {
        return { error: '微信登录失败，请重试' }
      }

      // 3. 建立本地会话（会话形态校验：token 成功交换但缺 user 视为失败）
      const { data: sessionData, error: sessionError } = await client.auth.setSession({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
      })
      if (sessionError || !sessionData?.session?.user?.id) {
        return { error: '微信登录失败，请重试' }
      }

      // 3.5 单设备会话登记（覆写 profiles.session_token，使后登录设备挤掉先登录设备）
      //     统一由 UserProvider 的 SIGNED_IN 事件经 applySession → establishSession 完成；
      //     setSession 已触发该事件，此处不再显式调用，否则与事件路径重复发两次
      //     touch_session（且绕过 establishedTokenRef 去重，存在自踢风险）。

      // 4. 按 profile 状态路由入口（资料补全 / 等待审核 / 审核未通过 / 首页；
      //    RPC 以会话 JWT 的 auth.uid() 为准，无需传 userId）
      await routeAfterLogin(client)
      return { error: null }
    } finally {
      // 无论成败都复位：避免异常时 submitting 卡 true
      submittingRef.current = false
      setSubmitting(false)
    }
  }, [client])

  return { submitting, loginWithWechat }
}
