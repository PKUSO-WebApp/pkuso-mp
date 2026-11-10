import { useCallback, useState } from 'react'
import { useUser, type User } from '@/context/user-context'
import { supabase as defaultClient } from '@/lib/supabase'
import { clearLegacySessionToken, markIntentionalSignOut } from '@/lib/device-session'
import { logDiag } from '@/lib/session-diag'
import { GUEST_ANNO_OWNER } from '@/lib/annotation'
import { clearAnnotationStorageFor } from '@/lib/annotation-migration'
import { flushAllAnnotationsForOwner } from '@/lib/annotation-sync-runner'
import type { Session } from '@supabase/supabase-js'

/** 登出前的最后同步最多等这么久；超时就按「没同步完」处理（本地键保留） */
const SIGN_OUT_FLUSH_TIMEOUT_MS = 3000

/**
 * D16 / C1：登出前尽力把批注欠账推上去。
 * **必须在 signOut 之前调用**（令牌一撤，RLS 会挡掉所有请求）。
 * 返回 false = 没确认推完 ⇒ 保留本地键（键已按账号隔离，不泄漏）。
 */
async function flushAnnotationsBeforeSignOut(owner: string): Promise<boolean> {
  // guest 没有云端账号可推；本地 guest 目录可以直接清
  if (owner === GUEST_ANNO_OWNER) return true
  try {
    return await Promise.race([
      flushAllAnnotationsForOwner(owner),
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), SIGN_OUT_FLUSH_TIMEOUT_MS)
      ),
    ])
  } catch {
    return false
  }
}

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
        logDiag('sign_in_error', { message: authError.message })
      }
      return { error: authError }
    },
    [client]
  )

  const signOut = useCallback(async (): Promise<void> => {
    const owner = user?.id ?? GUEST_ANNO_OWNER
    // ⚠️ 先同步、再登出：令牌撤销后 RLS 会把所有请求挡掉
    const flushed = await flushAnnotationsBeforeSignOut(owner)
    // 标记为主动登出，避免 onAuthStateChange 的 SIGNED_OUT 被误判为「被踢下线」
    markIntentionalSignOut()
    logDiag('sign_out_intentional')
    // scope 必须显式给 local：Supabase 默认是 global，会撤销该用户**所有设备**的会话。
    // 而这里的语义只是「本机退出」——紧接着就是 clearLegacySessionToken()（只清本机残留）。
    const { error: authError } = await client.auth.signOut({ scope: 'local' })
    // 顺手清掉旧单设备模型的令牌残留（新模型下它已不是判据，但留着没用）
    clearLegacySessionToken()
    if (authError) {
      setError(authError.message)
    } else if (flushed) {
      // 确认推完才删本地：没推完就删等于丢用户没同步的笔迹
      clearAnnotationStorageFor(owner)
      clearAnnotationStorageFor(GUEST_ANNO_OWNER)
    }
  }, [client, user?.id])

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
