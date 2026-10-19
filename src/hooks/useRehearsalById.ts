import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthSession } from '@/hooks/useAuthSession'
import { logDiag } from '@/lib/session-diag'
import type { RehearsalRow } from '@/types/database'

/**
 * 按 id 取单条排练的加载状态。
 *
 * 与「直接 maybeSingle」的区别：这里把三类**不能等同于「不存在」**的情况单独建模：
 * - 鉴权还没就绪（`auth-pending`）；
 * - 确定未登录（`auth-required`，页面守卫负责跳登录）；
 * - 会话恢复失败/查询失败（`auth-error` / `error`，可重试）。
 *
 * 只有 `ready && user` + `ensureSession()` 成功 + 查询成功 + 0 行，才是 `not-found`。
 * 这正好堵住 RLS 对匿名身份返回 `200 []` 被误读成「排练已被删除」的那条路。
 */
export type RehearsalLoadStatus =
  'auth-pending' | 'auth-required' | 'auth-error' | 'loading' | 'error' | 'not-found' | 'ready'

export type RehearsalByIdResult = {
  rehearsal: RehearsalRow | null
  status: RehearsalLoadStatus
  /** 重新查询（网络错误/手动重试） */
  retry: () => void
  /** 重新恢复会话（冷启动超时/弱网时用） */
  retryRestore: () => Promise<void>
}

export function useRehearsalById(rawId: number | null): RehearsalByIdResult {
  const id = rawId && Number.isFinite(rawId) && rawId > 0 ? rawId : null
  const { ready, user, restoreFailed, ensureSession, retryRestore } = useAuthSession()
  // 用 id/布尔值做依赖：token 刷新会产生新的 user 对象，但 id 不变，不应触发重查。
  const userId = user?.id
  const hasUser = !!userId
  const [rehearsal, setRehearsal] = useState<RehearsalRow | null>(null)
  const [status, setStatus] = useState<RehearsalLoadStatus>('auth-pending')
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    if (!id) {
      setRehearsal(null)
      setStatus('not-found')
      return
    }
    if (!ready) {
      setStatus('auth-pending')
      return
    }
    if (restoreFailed && !hasUser) {
      // 恢复超时/网络失败：用户可能其实是登录着的，先显示可重试的错误，
      // 不要当成游客送去登录页（那会让弱网用户白重登一次）。
      setStatus('auth-error')
      return
    }
    if (!hasUser) {
      // 确定没有会话：守卫负责跳登录，本 hook 只报告状态，绝不发匿名查询。
      setStatus('auth-required')
      return
    }

    let cancelled = false
    setStatus('loading')
    void (async () => {
      try {
        // 关键一步：本地 user 可能是旧值（refresh token 已失效、auth 尚未清空），
        // 匿名查询会得到 200 [] 而不是错误。先确认会话存在再查。
        const hasSession = await ensureSession()
        if (cancelled) return
        if (!hasSession) {
          setStatus('auth-required')
          return
        }
        const { data, error } = await supabase
          .from('rehearsals')
          .select('*')
          .eq('id', id)
          .maybeSingle()
        if (cancelled) return
        if (error) {
          logDiag('rehearsal_detail_query_failed', {
            id,
            code: error.code,
            message: error.message,
          })
          setRehearsal(null)
          setStatus('error')
          return
        }
        setRehearsal((data as RehearsalRow) ?? null)
        setStatus(data ? 'ready' : 'not-found')
      } catch (err) {
        if (cancelled) return
        logDiag('rehearsal_detail_query_failed', {
          id,
          err: err instanceof Error ? err.message : String(err),
        })
        setRehearsal(null)
        setStatus('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [id, ready, userId, hasUser, restoreFailed, ensureSession, retryNonce])

  const retry = useCallback(() => setRetryNonce((n) => n + 1), [])

  return { rehearsal, status, retry, retryRestore }
}
