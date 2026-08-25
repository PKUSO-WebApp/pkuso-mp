import { useEffect, type ReactNode } from 'react'
import Taro from '@tarojs/taro'
import { useUser } from '@/context/user-context'
import { useNotifications } from '@/hooks/useNotifications'
import { setTabBarUnread } from '@/lib/tabBarBadge'

/** profile 页标记已读成功后广播，触发 App 根红点重新拉取未读数 */
export const NOTIFICATION_UPDATED_EVENT = 'notifications:updated'

export function notifyNotificationsUpdated() {
  Taro.eventCenter.trigger(NOTIFICATION_UPDATED_EVENT)
}

export function NotificationBadgeSync({ children }: { children?: ReactNode }) {
  const { user, ready } = useUser()
  const { totalUnread, refresh } = useNotifications()

  // 冷启动刷新未读数：等会话真正就绪（ready）再查，避免 user 刚出现、但 Supabase
  // 客户端会话尚未应用到查询层，RLS 查询返回空导致 totalUnread 恒为 0（红点不显示）。
  // 同时 user 变化（登录/切换）时也重新拉取。
  useEffect(() => {
    if (ready || user?.id) void refresh()
  }, [ready, user?.id, refresh])

  // 回前台强制重拉：后台/关闭期间管理端写入的未读，可能被心跳首轮基线吞掉
  // （回前台首轮 tick 只建基线不广播），此处兜底保证红点与「我的」行内数字不漏报
  useEffect(() => {
    const onShow = () => {
      if (ready || user?.id) void refresh()
    }
    Taro.onAppShow?.(onShow)
    return () => {
      Taro.offAppShow?.(onShow)
    }
  }, [ready, user?.id, refresh])

  // profile 页标记已读成功后广播，这里重新拉取以便红点同步消失
  useEffect(() => {
    const handler = () => void refresh()
    Taro.eventCenter.on(NOTIFICATION_UPDATED_EVENT, handler)
    return () => {
      Taro.eventCenter.off(NOTIFICATION_UPDATED_EVENT, handler)
    }
  }, [refresh])

  // 未读数变化时写入模块级 store，custom tabBar 订阅渲染「我的」红点
  // （不再依赖原生 showTabBarRedDot，避免冷启动 "not TabBar page" 竞态与无法控尺寸）
  useEffect(() => {
    setTabBarUnread(totalUnread)
  }, [totalUnread])

  return <>{children}</>
}
