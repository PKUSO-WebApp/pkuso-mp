import { useCallback, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { supabase as defaultClient } from '@/lib/supabase'
import { describeError, reportClientError } from '@/lib/error-report'
import { DIAG_HEADER, newDiagId } from '@/lib/diag'
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
        const errMsg = describeError(err)
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
      //
      // diag：这次请求的关联 id。同一个值既随请求头送给服务端（它写进函数日志），
      // 也写进下面的失败记录——登录失败时客户端还没有会话（user_id 是 null），
      // 两端除了时间戳原本没有任何可对账的字段。见 lib/diag.ts。
      const diag = newDiagId()
      const { data, error: invokeError } = await client.functions.invoke('wechat-auth', {
        body: { code, mode: 'login' },
        headers: { [DIAG_HEADER]: diag },
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
        // 三类信息缺一不可，各自的用途不同：
        // - errorName 区分「网络层根本没连上」（FunctionsFetchError）与「服务端返回了
        //   非 2xx」（FunctionsHttpError）——这两类的修法完全不同；
        // - httpStatus 是平台网关（502/504）与我们自己函数的错误之间**唯一**的分界：
        //   网关的响应体不是我们的 JSON，serverError 会是空串，没有状态码就等于什么都没说；
        // - serverError 是函数自己的 error 字符串（如 'token exchange failed'）。
        reportClientError({
          event: 'wechat_login',
          message: (invokeError as { message?: string }).message ?? 'functions.invoke failed',
          detail: {
            step: 'invoke',
            diag,
            errorName: (invokeError as { name?: string }).name,
            httpStatus: (invokeError as { context?: { status?: number } }).context?.status,
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

      // user_not_found → 弹窗提示并跳转注册页。
      // ⚠️ showModal 必须单独兜住：它 reject 时（真机上见过——modal 未弹出/被抢占）
      // 异常会冒泡出 loginWithWechat，调用方 catch 后兜底成「微信登录失败，请重试」，
      // 于是「你没注册」被显示成「登录失败」，而且 **reLaunch 跳注册页也被一起跳过**。
      // 失败也要跳转，并把 modal 的真实错误记下来。
      if (payload?.error === 'user_not_found') {
        try {
          await Taro.showModal({
            title: t('login.notRegisteredTitle'),
            content: t('login.notRegisteredContent'),
            showCancel: false,
            confirmText: t('login.goRegister'),
          })
        } catch (err) {
          const errMsg = describeError(err)
          reportClientError({
            event: 'wechat_login',
            message: `user_not_found 弹窗失败: ${errMsg}`,
            detail: { step: 'user_not_found_modal', errMsg },
          })
        }
        void Taro.reLaunch({ url: '/pages/register/index' })
        return { error: null }
      }

      if (!payload?.access_token || !payload?.refresh_token) {
        reportClientError({
          event: 'wechat_login',
          message: 'payload missing tokens',
          detail: {
            step: 'invoke',
            diag,
            // 200 但没 token：把 payload 的**键名**记下来。带 error 字段却没有 token 时，
            // 键名本身就是线索（而且不能记值——那里面是服务端返回的会话材料）
            payloadKeys: Object.keys(payload ?? {}).join(','),
          },
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
          // GoTrue 的 code（如 refresh_token_not_found / invalid_grant）与 HTTP 状态
          // 是判「token 被别的设备顶掉了」还是「服务端 5xx」的依据，message 里读不出来
          detail: {
            step: 'set_session',
            diag,
            errorName: sessionError?.name,
            errorCode: sessionError?.code,
            httpStatus: sessionError?.status,
          },
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
