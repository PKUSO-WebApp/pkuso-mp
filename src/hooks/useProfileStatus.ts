import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
import { useUser } from '@/context/user-context'
import { useT } from '@/i18n'
import type { EntryProfile } from '@/lib/profile-gate'

// ============================================================
// 当前登录用户 profile 读取（守卫页/资料补全页用）：
// 经 SECURITY DEFINER RPC get_my_profile_entry 读取——profiles 表已撤销
// authenticated 表级 SELECT（email 等敏感列不可直查，直接查表报
// permission denied，与审核状态无关的所有成员都会失败）。
// RPC 按 auth.uid() 返回本人行，权限面不扩大。
// 竞态守卫用递增序号：快速重试/连续切换时只采纳最后一次查询结果。
// ============================================================

export function useProfileStatus(client: typeof defaultClient = defaultClient) {
  const { user } = useUser()
  const { t } = useT()
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
      const { data, error: queryError } = await client.rpc('get_my_profile_entry')
      if (current !== seq.current) return
      setProfile((data as EntryProfile[] | null)?.[0] ?? null)
      setError(queryError?.message ?? null)
    } catch {
      if (current !== seq.current) return
      setError(t('common.errors.loadFailed'))
    } finally {
      if (current === seq.current) setLoading(false)
    }
  }, [client, user, t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { profile, loading, error, refresh }
}
