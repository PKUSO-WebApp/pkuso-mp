import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { useDidShow, useDidHide } from '@tarojs/taro'
import { useUser } from '@/context/user-context'
import { dataSyncStart, dataSyncStop } from '@/lib/dataSync'

// 全局轮询的开关：仅在「前台 + 会话就绪」时运行（后台微信会冻结计时器，登出后也无意义）。
// 生命周期挂在 App 根（与 NotificationBadgeSync 同一层），保证全程只有一个轮询实例。
export function DataSyncProvider({ children }: { children?: ReactNode }) {
  const { ready } = useUser()
  const shownRef = useRef(false)

  useDidShow(() => {
    shownRef.current = true
    if (ready) dataSyncStart()
  })
  useDidHide(() => {
    shownRef.current = false
    dataSyncStop()
  })

  // 会话从恢复/登录切换到就绪时立即起轮询（冷启动先 onShow 再 ready 的场景）
  useEffect(() => {
    if (ready && shownRef.current) dataSyncStart()
    else if (!ready) dataSyncStop()
  }, [ready])

  return <>{children}</>
}
