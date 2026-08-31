import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
import { subscribeSync } from '@/lib/dataSync'
import { APP_ERROR, type AppErrorCode } from '@/lib/appError'
import type { AnnouncementRow } from '@/types/database'

// 公告 hook（成员端）：获取所有公告，供首页按“当前/历史”分组展示
export function useAnnouncements(client: typeof defaultClient = defaultClient) {
  const [data, setData] = useState<AnnouncementRow[]>([])
  const [loading, setLoading] = useState(true)
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
    void fetch()
    return () => {
      mountedRef.current = false
    }
  }, [fetch])

  // 心跳检测到公告版本变化后静默重取
  useEffect(() => {
    const handler = () => {
      void fetch({ silent: true })
    }
    return subscribeSync('announcements', handler)
  }, [fetch])

  return { data, loading, error, fetch }
}