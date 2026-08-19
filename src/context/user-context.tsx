import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'

// 会话恢复超时阈值：弱网/挂起时不再无限等待（SDK 默认等待较长），超时降级为「未登录 + 恢复失败」
const RESTORE_TIMEOUT_MS = 10000

// 小程序端 user = 会话中的 auth 用户（profile 详情由后续任务加载）
export type User = {
  id: string
  email: string | null
  emailConfirmed: boolean
}

export type UserContextValue = {
  session: Session | null
  user: User | null
  // 初始会话恢复是否完成：未完成前由页面渲染占位，避免登录页闪烁
  ready: boolean
  // 会话恢复是否失败（超时/异常）：为 true 时页面可提示「网络异常，请重试」
  restoreFailed: boolean
}

const UserContext = createContext<UserContextValue | undefined>(undefined)

export function UserProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [restoreFailed, setRestoreFailed] = useState(false)

  // 冷启动恢复会话 + 订阅 auth 状态变化（client.auth 引用稳定，只需执行一次）
  useEffect(() => {
    let mounted = true
    // 事件是否先于 getSession resolve 到达（SDK 真实时序：订阅后 INITIAL_SESSION 先行）。
    // 事件先到时以事件为准，慢查询的 getSession 结果不覆盖已登录状态
    let eventArrived = false

    const init = async () => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      try {
        const { data } = await Promise.race([
          supabase.auth.getSession(),
          // 超时兜底：直接走降级分支，避免登录页长期挂起
          new Promise<never>((_resolve, reject) => {
            timeoutId = setTimeout(() => reject(new Error('会话恢复超时')), RESTORE_TIMEOUT_MS)
          }),
        ])
        if (!mounted) return
        if (!eventArrived) {
          setSession(data.session)
        }
        setRestoreFailed(false)
      } catch {
        if (!mounted) return
        // 事件已给出会话时不降级（超时只是 getSession 未返回，会话仍可用）
        if (!eventArrived) {
          setSession(null)
          setRestoreFailed(true)
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId)
        if (mounted) setReady(true)
      }
    }
    void init()

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return
      eventArrived = true
      setSession(nextSession)
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const user = useMemo<User | null>(() => {
    const authUser = session?.user
    if (!authUser) return null
    return {
      id: authUser.id,
      email: authUser.email ?? null,
      emailConfirmed: !!authUser.email_confirmed_at,
    }
  }, [session])

  const value = useMemo(
    () => ({ session, user, ready, restoreFailed }),
    [session, user, ready, restoreFailed]
  )

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

export function useUser() {
  const ctx = useContext(UserContext)
  if (!ctx) {
    throw new Error('useUser 必须在 UserProvider 内部使用')
  }
  return ctx
}
