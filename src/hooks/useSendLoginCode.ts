import { useCallback, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
import { describeError, reportClientError } from '@/lib/error-report'
import { useCountdown } from './useCountdown'

export type UseSendLoginCodeResult = {
  sending: boolean
  countdown: number
  isCountingDown: boolean
  sendCode: (email: string) => Promise<{ success: boolean; notRegistered?: boolean }>
}

/**
 * 发送登录验证码的 hook。
 * 调用 send-login-code Edge Function（无 JWT），内置 60s 倒计时。
 * 返回 notRegistered=true 表示邮箱未注册，前端应引导注册。
 */
export function useSendLoginCode(
  client: typeof defaultClient = defaultClient
): UseSendLoginCodeResult {
  const [sending, setSending] = useState(false)
  const { countdown, start, isActive } = useCountdown(60)
  const sendingRef = useRef(false)

  const sendCode = useCallback(
    async (email: string): Promise<{ success: boolean; notRegistered?: boolean }> => {
      if (sendingRef.current || isActive) return { success: false }
      sendingRef.current = true
      setSending(true)
      try {
        const { data, error } = await client.functions.invoke('send-login-code', {
          body: { email: email.trim().toLowerCase() },
        })
        if (error) {
          // 服务端对「未注册」也返回 200（body 里带 user_not_found），所以走到这里
          // 意味着 invoke 在 HTTP/网络层就失败了——前端只会显示一句「验证码发送失败」，
          // 而 errorName 才能区分是没连上（FunctionsFetchError）还是非 2xx（FunctionsHttpError）。
          reportClientError({
            event: 'send_login_code',
            message: (error as { message?: string }).message ?? 'functions.invoke failed',
            detail: { step: 'invoke', errorName: (error as { name?: string }).name },
          })
          return { success: false }
        }
        // 检查用户是否存在
        if (data?.error === 'user_not_found') {
          return { success: false, notRegistered: true }
        }
        start()
        return { success: true }
      } catch (err) {
        reportClientError({
          event: 'send_login_code',
          message: describeError(err),
          detail: { step: 'throw', errorName: (err as { name?: string })?.name },
        })
        return { success: false }
      } finally {
        sendingRef.current = false
        setSending(false)
      }
    },
    [client, isActive, start]
  )

  return { sending, countdown, isCountingDown: isActive, sendCode }
}
