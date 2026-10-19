import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
import { subscribeSync } from '@/lib/dataSync'
import { APP_ERROR, type AppErrorCode } from '@/lib/appError'
import type { AnnouncementRow } from '@/types/database'

// 公告 hook（成员端）：获取所有公告，供首页按“当前/历史”分组展示
export function useAnnouncements(
  client: typeof defaultClient = defaultClient,
  options: { enabled?: boolean } = {}
) {
  // 鉴权门控：登录态就绪前不自动查（announcements 的 SELECT 只授 authenticated，
  // 匿名查询会返回 200 []，与「真的没有公告」同形）。
  const enabled = options.enabled ?? true
  const [data, setData] = useState<AnnouncementRow[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<AppErrorCode | null>(null)
  const mountedRef = useRef(true)
  const fetchSeqRef = useRef(0)

  // 获取所有公告（按 created_at 降序）
  const fetch = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!mountedRef.current) return
      const seq = ++fetchSeqRef.current
      if (!opts?.silent) setLoading(true)
      setError(null)
      const { data: rows, error: dbError } = await client
        .from('announcements')
        .select('id, content, created_at, title, end_time')
        .order('created_at', { ascending: false })
      if (!mountedRef.current || seq !== fetchSeqRef.current) return
      setLoading(false)
      if (dbError) {
        console.error('[useAnnouncements] 公告加载失败', dbError)
        setError(APP_ERROR.loadFailed)
        setData([])
        return
      }
      setData((Array.isArray(rows) ? rows : []) as AnnouncementRow[])
    },
    [client]
  )

  useEffect(() => {
    mountedRef.current = true
    if (enabled) {
      void fetch()
    } else {
      setLoading(false)
    }
    return () => {
      mountedRef.current = false
    }
  }, [fetch, enabled])

  // 心跳检测到公告版本变化后静默重取。未就绪时不订阅，避免绕过门控发匿名查询。
  useEffect(() => {
    if (!enabled) return
    const handler = () => {
      void fetch({ silent: true })
    }
    return subscribeSync('announcements', handler)
  }, [fetch, enabled])

  return { data, loading, error, fetch }
}
