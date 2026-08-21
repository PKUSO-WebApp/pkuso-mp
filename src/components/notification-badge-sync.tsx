import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import Taro from '@tarojs/taro'
import { useUser } from '@/context/user-context'
import { useNotifications } from '@/hooks/useNotifications'
import { BadgeSyncContext } from '@/components/badge-sync-context'

/** profile 页标记已读成功后广播，触发 App 根红点重新拉取未读数 */
export const NOTIFICATION_UPDATED_EVENT = 'notifications:updated'

export function notifyNotificationsUpdated() {
  Taro.eventCenter.trigger(NOTIFICATION_UPDATED_EVENT)
}

export function NotificationBadgeSync({ children }: { children?: ReactNode }) {
  const { user, ready } = useUser()
  const { totalUnread, refresh } = useNotifications()

  const noop = () => {}
  const totalUnreadRef = useRef(totalUnread)
  totalUnreadRef.current = totalUnread

  // 重设红点：在未读数变化、或某 tab 页 useDidShow 触发时调用。
  // 注意 tabBar 红点 API 只在 tabBar 页面可用，非 tabBar 页面调用会 reject "not TabBar page"，
  // 必须用 .catch 吞掉，否则成为未处理 rejection 导致报错/卡死页面。
  const sync = useCallback(() => {
    const n = totalUnreadRef.current
    if (n > 0) {
      void Taro.showTabBarRedDot({ index: 4 }).catch(noop)
    } else {
      void Taro.hideTabBarRedDot({ index: 4 }).catch(noop)
    }
  }, [])

  // 冷启动刷新未读数：等会话真正就绪（ready）再查，避免 user 刚出现、但 Supabase
  // 客户端会话尚未应用到查询层，RLS 查询返回空导致 totalUnread 恒为 0（红点不显示）。
  // 同时 user 变化（登录/切换）时也重新拉取。
  useEffect(() => {
    if (ready || user?.id) void refresh()
  }, [ready, user?.id, refresh])

  // profile 页标记已读成功后广播，这里重新拉取以便红点同步消失
  useEffect(() => {
    const handler = () => void refresh()
    Taro.eventCenter.on(NOTIFICATION_UPDATED_EVENT, handler)
    return () => {
      Taro.eventCenter.off(NOTIFICATION_UPDATED_EVENT, handler)
    }
  }, [refresh])

  // 未读数变化时同步（此刻若在 tabBar 页则生效；非 tabBar 页调用被静默忽略，
  // 待用户进入 tab 页时再由该页 useDidShow 里的 sync 补设）。
  useEffect(() => {
    sync()
  }, [totalUnread, sync])

  return <BadgeSyncContext.Provider value={{ sync }}>{children}</BadgeSyncContext.Provider>
}
