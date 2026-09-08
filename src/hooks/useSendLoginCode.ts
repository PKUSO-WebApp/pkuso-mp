import { useCallback, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
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
          return { success: false }
        }
        // 检查用户是否存在
        if (data?.error === 'user_not_found') {
          return { success: false, notRegistered: true }
        }
        start()
        return { success: true }
      } catch {
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
