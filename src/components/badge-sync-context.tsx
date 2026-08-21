import { createContext, useContext } from 'react'
import { useDidShow } from '@tarojs/taro'

export type BadgeSyncValue = { sync: () => void }

export const BadgeSyncContext = createContext<BadgeSyncValue | null>(null)

/**
 * 在每个 tab 页内调用：进入该 tab 页时按当前未读数重设「我的」红点。
 *
 * NotificationBadgeSync 挂在 App 根、位于 PageContext.Provider 之外，其 useDidShow 只会在
 * 小程序前后台切换时触发，不会随 tab 页切换触发；因此红点重设必须放到 tab 页自身的
 * useDidShow 里，才能在「进入 tab 页」这一刻生效——否则冷启动时先停在登录页（非 tabBar 页），
 * 首次 showTabBarRedDot 因 "not TabBar page" 被静默忽略，之后未读数不再变化，红点永不显示。
 *
 * 本模块刻意只依赖 react 与 @tarojs/taro 的 useDidShow，不引入 useNotifications/supabase，
 * 以免在只渲染页面、未挂载 NotificationBadgeSync 的单元测试中把 supabase 一并拉进来。
 */
export function useTabBarBadgeSync() {
  const ctx = useContext(BadgeSyncContext)
  const sync = ctx?.sync
  useDidShow(() => {
    sync?.()
  })
}
