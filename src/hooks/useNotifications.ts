import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
import { dataSyncBump, subscribeSync } from '@/lib/dataSync'
import type { NotificationCategory, NotificationRow } from '@/types/database'

/** 三个信箱分类（profile 页按钮共用） */
export const NOTIFICATION_CATEGORIES: NotificationCategory[] = ['attendance', 'activity', 'system']

/** 各分类未读数（读取时全 0，与 RLS 下无通知等价） */
export type UnreadCounts = Record<NotificationCategory, number>

/** 分类消息列表查询结果：error 非空为失败（rows 为空数组） */
export type NotificationListResult = { rows: NotificationRow[]; error: string | null }

/**
 * 通知未读数 + 分类信箱 hook（Issue #188 语义移植）。
 *
 * 未读查询：RLS 只返回自己名下的通知，`select("category").is("read_at", null)`
 * 一次拉回全部未读行，前端按 category 分组计数（列表规模小，无需服务端聚合）。
 *
 * 与 Web 版差异：
 * - 无全局 context（仅 profile 页使用，页面内直接持实例）；
 * - 卸载后不再 setState（mountedRef 标志位）；
 * - fetchByCategory 收敛到 hook 内（Web 端在页面内联查询）。
 */
export function useNotifications(client: typeof defaultClient = defaultClient) {
  const [unreadCounts, setUnreadCounts] = useState<UnreadCounts>({
    attendance: 0,
    activity: 0,
    system: 0,
  })
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  /** 重新拉取未读数（挂载时调用） */
  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    const { data, error } = await client
      .from('notifications')
      .select('category')
      .is('read_at', null)
    if (!mountedRef.current) return
    setLoading(false)
    if (error) {
      console.error('[Notifications] 未读数查询失败', error.message)
      return
    }
    const counts: UnreadCounts = { attendance: 0, activity: 0, system: 0 }
    for (const row of (data ?? []) as { category: NotificationCategory }[]) {
      if (row.category in counts) counts[row.category] += 1
    }
    setUnreadCounts(counts)
  }, [client])

  // 心跳检测到未读数变化后静默重取（不翻 loading；红点由 NotificationBadgeSync 统一刷新）
  useEffect(() => {
    const handler = () => {
      void refresh({ silent: true })
    }
    return subscribeSync('notifications', handler)
  }, [refresh])

  /** 拉取某分类的消息列表（created_at 倒序） */
  const fetchByCategory = useCallback(
    async (category: NotificationCategory): Promise<NotificationListResult> => {
      const { data, error } = await client
        .from('notifications')
        .select('*')
        .eq('category', category)
        .order('created_at', { ascending: false })
      if (error) {
        return { rows: [], error: error.message }
      }
      return { rows: (data as NotificationRow[]) ?? [], error: null }
    },
    [client]
  )

  /**
   * 打开信箱即全部已读：只标记本次 fetch 到的消息 id（.in("id", ids)）——
   * 打开信箱瞬间到达的新通知不在 ids 内，不会被无界更新误标已读；
   * ids 为空（该分类本无未读）时跳过 update 直接归零。
   * update 带 .is("read_at", null) 守卫 + .select("id") 0 行检测：
   * RLS 静默失败/并发已读时 0 行无 error，此时返回 false 且不归零本地计数。
   */
  const markCategoryRead = useCallback(
    async (category: NotificationCategory, ids: string[]): Promise<boolean> => {
      if (ids.length === 0) {
        // 无未读行可标（fetch 已确认该分类无未读）：直接归零
        setUnreadCounts((prev) => ({ ...prev, [category]: 0 }))
        dataSyncBump()
        return true
      }
      try {
        const { data, error } = await client
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .in('id', ids)
          .is('read_at', null)
          .select('id')
        if (error) {
          console.error('[Notifications] 标记已读失败', error.message)
          return false
        }
        if (!data || data.length === 0) {
          // 0 行：RLS 静默失败或全部被并发标已读，不执行本地归零
          return false
        }
      } catch (err) {
        console.error('[Notifications] 标记已读失败', err)
        return false
      }
      if (!mountedRef.current) return true
      setUnreadCounts((prev) => ({ ...prev, [category]: 0 }))
      return true
    },
    [client]
  )

  const totalUnread = NOTIFICATION_CATEGORIES.reduce((sum, c) => sum + unreadCounts[c], 0)

  return { unreadCounts, totalUnread, loading, refresh, fetchByCategory, markCategoryRead }
}
