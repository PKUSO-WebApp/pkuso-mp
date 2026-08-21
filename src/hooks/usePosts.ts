import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
import type { PostRow, PostRowWithAuthor } from '@/types/database'

/**
 * 公告 hook（只读，demo 阶段）。
 * 与 Web 版差异：无 realtime（挂载查询 + 手动重取）；
 * 加载失败错误归一化为中文文案；卸载后不再 setState（mountedRef 标志位）。
 * 写操作（发布/编辑/删除）pending，待内容安全接入后实现（规划 §1 阶段 4）。
 *
 * 成员端默认过滤已锁定帖子（is_locked = false）；author join 可能为对象或数组，
 * 这里统一归一化为 { full_name, instrument } | null，下游渲染无需关心形态。
 */
export function usePosts(client: typeof defaultClient = defaultClient) {
  const [data, setData] = useState<PostRowWithAuthor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const fetchSeqRef = useRef(0)

  const fetch = useCallback(async () => {
    if (!mountedRef.current) return null
    const seq = ++fetchSeqRef.current
    setLoading(true)
    setError(null)
    const { data: rows, error: dbError } = await client
      .from('posts')
      .select(
        'id, title, type, content, image_url, author_id, created_at, contact_info, current_sections, missing_sections, is_locked, profiles(full_name, instrument)'
      )
      .eq('is_locked', false)
      .order('created_at', { ascending: false })
    if (!mountedRef.current || seq !== fetchSeqRef.current) return null
    setLoading(false)
    if (dbError) {
      setError('公告加载失败，请重试')
      setData([])
      return null
    }
    const list = (rows as unknown[])?.map((row) => {
      const r = row as PostRow & { profiles?: unknown }
      const p = r.profiles as Record<string, unknown> | undefined
      const profiles =
        Array.isArray(p) && p.length > 0
          ? {
              full_name: (p[0] as Record<string, string | null>).full_name,
              instrument: (p[0] as Record<string, string | null>).instrument,
            }
          : p && typeof p === 'object' && !Array.isArray(p)
            ? (p as { full_name: string | null; instrument: string | null })
            : null
      return { ...r, profiles }
    }) as PostRowWithAuthor[]
    setData(list)
    return list
  }, [client])

  useEffect(() => {
    mountedRef.current = true
    void fetch()
    return () => {
      mountedRef.current = false
    }
  }, [fetch])

  return { data, loading, error, fetch }
}
