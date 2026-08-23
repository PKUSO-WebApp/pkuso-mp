import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
import { subscribeSync } from '@/lib/dataSync'
import type { AnnouncementRow } from '@/types/database'

// 公告 hook（成员端）：获取最新一条公告。
// 与 Web 版差异：
// - 小程序为成员端，无 admin 服务端 REST（fetchAll/publish/remove/update 依赖
//   /api/admin/announcement + window.fetch），已移除；
// - 加载失败错误归一化为中文文案；卸载后不再 setState（mountedRef 标志位）。
export function useAnnouncements(client: typeof defaultClient = defaultClient) {
  const [data, setData] = useState<AnnouncementRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const fetchSeqRef = useRef(0)

  // 获取最新一条公告（供成员端展示）
  const fetch = useCallback(async (opts?: { silent?: boolean }) => {
    if (!mountedRef.current) return
    const seq = ++fetchSeqRef.current
    if (!opts?.silent) setLoading(true)
    setError(null)
    const { data: rows, error: dbError } = await client
      .from('announcements')
      .select('id, content, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
    if (!mountedRef.current || seq !== fetchSeqRef.current) return
    setLoading(false)
    if (dbError) {
      // 错误归一化：加载失败统一中文文案
      setError('数据加载失败，请重试')
      setData(null)
      return
    }
    const row = Array.isArray(rows) && rows.length > 0 ? (rows[0] as AnnouncementRow) : null
    setData(row)
  }, [client])

  useEffect(() => {
    mountedRef.current = true
    void fetch()
    return () => {
      mountedRef.current = false
    }
  }, [fetch])

  // 心跳检测到「最新公告」版本变化后静默重取（公告后续会展示在成员主页，届时即自动生效）
  useEffect(() => {
    const handler = () => {
      void fetch({ silent: true })
    }
    return subscribeSync('announcements', handler)
  }, [fetch])

  return { data, loading, error, fetch }
}
