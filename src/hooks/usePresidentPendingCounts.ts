import { useCallback, useEffect, useRef, useState } from 'react'
import { useDidShow } from '@tarojs/taro'
import { supabase as defaultClient } from '@/lib/supabase'

export type PresidentPendingCounts = {
  leave: number
  membership: number
  attendance: number
}

const EMPTY: PresidentPendingCounts = { leave: 0, membership: 0, attendance: 0 }

function normalize(data: unknown): PresidentPendingCounts {
  const row = Array.isArray(data) ? data[0] : null
  if (!row || typeof row !== 'object') return EMPTY
  const r = row as Record<string, unknown>
  return {
    leave: typeof r.leave_pending === 'number' ? r.leave_pending : 0,
    membership: typeof r.membership_pending === 'number' ? r.membership_pending : 0,
    attendance: typeof r.attendance_change_pending === 'number' ? r.attendance_change_pending : 0,
  }
}

/**
 * 团长「我的」页三个审批徽章的计数。
 *
 * 用单个 RPC 拉三个数，避免为了徽章去拉三份完整申请列表；失败时保留上一次值，
 * 不把徽章闪成 0。enabled=false 时不发请求（没有审批能力时不挂这个 hook）。
 */
export function usePresidentPendingCounts(
  enabled = true,
  client: typeof defaultClient = defaultClient
) {
  const [counts, setCounts] = useState<PresidentPendingCounts>(EMPTY)
  const [loading, setLoading] = useState(enabled)
  const mountedRef = useRef(true)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const clientRef = useRef(client)
  clientRef.current = client
  const seqRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!enabledRef.current) return
    const seq = ++seqRef.current
    if (!opts?.silent) setLoading(true)
    const { data, error } = await clientRef.current.rpc('president_pending_counts')
    if (!mountedRef.current || seq !== seqRef.current) return
    setLoading(false)
    if (error) {
      console.error('[PresidentPendingCounts] 查询失败', error.message)
      return
    }
    setCounts(normalize(data))
  }, [])

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    void refresh()
  }, [enabled, refresh])

  useDidShow(() => {
    if (enabledRef.current) void refresh({ silent: true })
  })

  return { counts, loading, refresh }
}
