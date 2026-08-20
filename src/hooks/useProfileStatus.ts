import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
import { useUser } from '@/context/user-context'
import type { EntryProfile } from '@/lib/profile-gate'

// ============================================================
// 当前登录用户 profile 读取（守卫页用）：
// 直接查 profiles 表（RLS 允许读自己行，与审核状态无关——profiles_roster
// 视图面向已通过用户的花名册场景，不适用于待审核用户）。
// 竞态守卫用递增序号：快速重试/连续切换时只采纳最后一次查询结果。
// ============================================================

export function useProfileStatus(client: typeof defaultClient = defaultClient) {
  const { user } = useUser()
  const [profile, setProfile] = useState<EntryProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const refresh = useCallback(async () => {
    if (!user) return
    const current = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const { data, error: queryError } = await client
        .from('profiles')
        .select('full_name, email, status')
        .eq('id', user.id)
        .maybeSingle()
      if (current !== seq.current) return
      setProfile((data as EntryProfile | null) ?? null)
      setError(queryError?.message ?? null)
    } catch {
      if (current !== seq.current) return
      setError('网络异常，请重试')
    } finally {
      if (current === seq.current) setLoading(false)
    }
  }, [client, user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { profile, loading, error, refresh }
}
