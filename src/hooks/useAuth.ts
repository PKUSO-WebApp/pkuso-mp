import { useCallback, useState } from 'react'
import { useUser, type User } from '@/context/user-context'
import { supabase as defaultClient } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'

// 与 SDK AuthError 结构兼容的最小错误类型（message 必填，code/status 可选）
export type AuthErrorLike = { message: string; code?: string; status?: number }

export type UseAuthResult = {
  session: Session | null
  user: User | null
  // 初始会话恢复是否完成
  ready: boolean
  // 恢复中为 true，供页面显示占位
  loading: boolean
  // 最近一次 auth 操作的错误信息（signIn/signOut/getSession 失败时写入）
  error: string | null
  signIn: (email: string, password: string) => Promise<{ error: AuthErrorLike | null }>
  signOut: () => Promise<void>
}

// 登录/登出/会话状态封装：会话状态来自 useUser（UserProvider 单一数据源），
// signIn/signOut 只负责调用 supabase auth，会话更新由 onAuthStateChange 回流到 context
export function useAuth(client: typeof defaultClient = defaultClient): UseAuthResult {
  const { session, user, ready } = useUser()
  const [error, setError] = useState<string | null>(null)

  const signIn = useCallback(
    async (email: string, password: string): Promise<{ error: AuthErrorLike | null }> => {
      setError(null)
      const { error: authError } = await client.auth.signInWithPassword({ email, password })
      if (authError) {
        setError(authError.message)
      }
      return { error: authError }
    },
    [client]
  )

  const signOut = useCallback(async (): Promise<void> => {
    const { error: authError } = await client.auth.signOut()
    if (authError) {
      setError(authError.message)
    }
  }, [client])

  return {
    session,
    user,
    ready,
    loading: !ready,
    error,
    signIn,
    signOut,
  }
}
