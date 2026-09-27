import { useCallback, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { supabase as defaultClient } from '@/lib/supabase'
import { reportClientError } from '@/lib/error-report'
import { routeAfterLogin } from '@/lib/post-auth-route'
import { useT } from '@/i18n'

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
  const { t } = useT()
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  const loginWithWechat = useCallback(async (): Promise<WechatLoginResult> => {
    if (submittingRef.current) return { error: t('login.duplicateSubmit') }
    submittingRef.current = true
    setSubmitting(true)
    try {
      // 1. wx.login 获取一次性 code
      let code = ''
      try {
        const loginRes = await Taro.login()
        code = loginRes.code ?? ''
      } catch (err) {
        // wx.login 失败此前只塌缩成一句「微信登录失败」，而它恰恰是「点了没反应、
        // 服务端查不到任何请求」这类现象的最上游来源——errMsg 必须留下来。
        const errMsg = (err as { errMsg?: string } | null)?.errMsg ?? String(err)
        reportClientError({
          event: 'wechat_login',
          message: errMsg,
          detail: { step: 'wx_login', errMsg },
        })
        return { error: t('login.wechatLoginFailed') }
      }
      if (!code) {
        reportClientError({
          event: 'wechat_login',
          message: 'wx.login returned empty code',
          detail: { step: 'wx_login', emptyCode: true, loginResult: Boolean(code) },
        })
        return { error: t('login.wechatLoginFailed') }
      }

      // 2. Edge Function 桥接：mode=login → 仅查找已有账号，不自动创建
      const { data, error: invokeError } = await client.functions.invoke('wechat-auth', {
        body: { code, mode: 'login' },
      })
      if (invokeError) {
        let message = t('login.wechatLoginFailed')
        let serverError = ''
        try {
          const ctx = await (
            invokeError as { context?: { json?: () => Promise<{ error?: string }> } }
          ).context?.json?.()
          serverError = ctx?.error ?? ''
          if (ctx?.error === 'wechat code2session failed') {
            message = t('login.wechatCodeExpired')
          }
        } catch {
          // 保留默认文案
        }
        // errorName 区分「网络层根本没连上」（FunctionsFetchError）与「服务端返回了
        // 非 2xx」（FunctionsHttpError）——这两类的修法完全不同，必须分开记。
        reportClientError({
          event: 'wechat_login',
          message: (invokeError as { message?: string }).message ?? 'functions.invoke failed',
          detail: {
            step: 'invoke',
            errorName: (invokeError as { name?: string }).name,
            serverError,
          },
        })
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
          title: t('login.notRegisteredTitle'),
          content: t('login.notRegisteredContent'),
          showCancel: false,
          confirmText: t('login.goRegister'),
        })
        void Taro.reLaunch({ url: '/pages/register/index' })
        return { error: null }
      }

      if (!payload?.access_token || !payload?.refresh_token) {
        reportClientError({
          event: 'wechat_login',
          message: 'payload missing tokens',
          detail: { step: 'invoke', payloadKeys: Object.keys(payload ?? {}).join(',') },
        })
        return { error: t('login.wechatLoginFailed') }
      }

      // 3. 建立本地会话
      const { data: sessionData, error: sessionError } = await client.auth.setSession({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
      })
      if (sessionError || !sessionData?.session?.user?.id) {
        reportClientError({
          event: 'wechat_login',
          message: sessionError?.message ?? 'setSession returned no session',
          detail: { step: 'set_session', errorName: sessionError?.name },
        })
        return { error: t('login.wechatLoginFailed') }
      }

      // 4. 按 profile 状态路由入口
      await routeAfterLogin(client)
      return { error: null }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }, [client, t])

  return { submitting, loginWithWechat }
}
