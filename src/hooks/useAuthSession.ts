import { useCallback } from 'react'
import { useUser, type User } from '@/context/user-context'
import { supabase } from '@/lib/supabase'
import { isRetryableAuthError } from '@/lib/auth-errors'
import { logDiag } from '@/lib/session-diag'

/**
 * 「这一页现在能不能带会话查库」的唯一判据。
 *
 * 为什么需要它：Supabase 的 RLS 对**匿名**身份没有 policy 时，PostgREST 不会报 401，
 * 而是返回 `200 []`。业务层（`maybeSingle`）把空数组翻译成 `data:null,error:null`，
 * 与「这条记录真的不存在」完全同形。冷启动时页面若在会话恢复完成前发查询，就会把
 * 「还没登录 / 会话还没恢复」误判成「排练/公告不存在」。
 *
 * 因此所有「受 authenticated RLS 保护」的页面都应：
 * 1. `ready && user && !restoreFailed` 才允许查；
 * 2. 查之前用 `ensureSession()` 确认 `getSession()` 真的拿到了会话；
 * 3. 空结果只有在 2 成立时才可以当成「不存在」。
 */
export type AuthSession = {
  ready: boolean
  user: User | null
  restoreFailed: boolean
  retryRestore: () => Promise<void>
  /** 鉴权已就绪、可以带会话查询 */
  canQuery: boolean
  /**
   * 查询前确认会话存在。
   * - true：可以查；
   * - false：确定没有会话（已顺手清本地会话，守卫会跳登录）；
   * - 抛错：网络/刷新失败——调用方应显示「加载失败，重试」，不要当作未登录或不存在。
   */
  ensureSession: () => Promise<boolean>
}

export function useAuthSession(): AuthSession {
  const { ready, user, restoreFailed, retryRestore } = useUser()

  const ensureSession = useCallback(async (): Promise<boolean> => {
    const { data, error } = await supabase.auth.getSession()
    if (data.session) return true
    if (error) {
      if (isRetryableAuthError(error)) {
        // 网络/5xx/限流：会话可能仍在本地，交给调用方展示可重试的错误，
        // 避免把「网络差」变成「被登出」。
        throw error
      }
      // refresh token 已失效 / session 已不存在：这是定论，重试没有意义。
      logDiag('auth_session_invalid', {
        name: error.name,
        code: error.code,
        status: error.status,
      })
      void supabase.auth.signOut({ scope: 'local' }).catch(() => {})
      return false
    }
    logDiag('auth_session_missing')
    // 本地 user 可能是旧值：清掉本地会话，让页面守卫接管跳登录。
    void supabase.auth.signOut({ scope: 'local' }).catch(() => {})
    return false
  }, [])

  return {
    ready,
    user,
    restoreFailed,
    retryRestore,
    canQuery: ready && !!user && !restoreFailed,
    ensureSession,
  }
}
