import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
import { dataSyncBump, emitSync, subscribeSync } from '@/lib/dataSync'
import { APP_ERROR, type AppErrorCode } from '@/lib/appError'
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
  // 未读数查询失败面（P2-6/P2-7）：失败产出稳定错误码，不再静默或透传 DB 原文
  const [error, setError] = useState<AppErrorCode | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  /** 重新拉取未读数（挂载时调用） */
  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true)
      // 防御性取值：emitSync 可能触达已卸载测试实例的遗留监听器（其 mock 无此查询链），
      // 结果为 undefined 时静默跳过，避免未处理拒绝
      const res = await client.from('notifications').select('category').is('read_at', null)
      if (!mountedRef.current || !res) return
      setLoading(false)
      const rows = (res.data ?? []) as { category: NotificationCategory }[]
      if (res.error) {
        console.error('[Notifications] 未读数查询失败', res.error.message)
        if (mountedRef.current) setError(APP_ERROR.loadFailed)
        return
      }
      if (mountedRef.current) setError(null)
      const counts: UnreadCounts = { attendance: 0, activity: 0, system: 0 }
      for (const row of rows) {
        if (row.category in counts) counts[row.category] += 1
      }
      setUnreadCounts(counts)
    },
    [client]
  )

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
      const { data, error: dbError } = await client
        .from('notifications')
        .select('*')
        .eq('category', category)
        .order('created_at', { ascending: false })
      if (dbError) {
        console.error('[Notifications] 分类消息查询失败', dbError.message)
        return { rows: [], error: APP_ERROR.loadFailed }
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
        // 无未读行可标（fetch 已确认该分类无未读）：直接归零。
        // 广播必须在 mounted 判断之外——离开页面路径上本实例已卸载，
        // 但其他实例（「我的」行内数字 / 底边栏红点）仍依赖此次刷新
        if (mountedRef.current) setUnreadCounts((prev) => ({ ...prev, [category]: 0 }))
        emitSync('notifications')
        dataSyncBump()
        return true
      }
      try {
        const { data, error: dbError } = await client
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .in('id', ids)
          .is('read_at', null)
          .select('id')
        if (dbError) {
          console.error('[Notifications] 标记已读失败', dbError.message)
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
      // 卸载只跳过本地 setState；广播无条件执行——否则离开页面路径上
      // （提交在途时页面已卸载）emitSync 被守卫拦截，所有红点都退化为等 30s 心跳
      if (mountedRef.current) setUnreadCounts((prev) => ({ ...prev, [category]: 0 }))
      emitSync('notifications')
      dataSyncBump()
      return true
    },
    [client]
  )

  /**
   * 标记单条通知已读（系统通知页逐条「标记已读」按钮用，Issue #188 语义扩展）：
   * 服务端 update read_at，带 .is("read_at", null) 守卫 + .select("id") 0 行检测
   * （RLS 静默失败/并发已读时 0 行无 error，返回 false 且不减量）；
   * 成功后把本地该分类未读数 -1（clamp 0），与 markCategoryRead 的「整类归零」互补。
   */
  const markItemRead = useCallback(
    async (category: NotificationCategory, id: string): Promise<boolean> => {
      try {
        const { data, error: dbError } = await client
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('id', id)
          .is('read_at', null)
          .select('id')
        if (dbError) {
          console.error('[Notifications] 标记已读失败', dbError.message)
          return false
        }
        if (!data || data.length === 0) {
          // 0 行：已被并发标已读或 RLS 静默失败，不执行本地减量
          return false
        }
      } catch (err) {
        console.error('[Notifications] 标记已读失败', err)
        return false
      }
      if (!mountedRef.current) return true
      setUnreadCounts((prev) => ({ ...prev, [category]: Math.max(0, prev[category] - 1) }))
      return true
    },
    [client]
  )

  const totalUnread = NOTIFICATION_CATEGORIES.reduce((sum, c) => sum + unreadCounts[c], 0)

  return {
    unreadCounts,
    totalUnread,
    loading,
    error,
    refresh,
    fetchByCategory,
    markCategoryRead,
    markItemRead,
  }
}
