import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useDidShow } from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'
import { clearSessionToken, establishSession, verifySession } from '@/lib/single-session'
import { ForceOfflineModal } from '@/components/force-offline-modal'

// 会话恢复超时阈值：弱网/挂起时不再无限等待（SDK 默认等待较长），超时降级为「未登录 + 恢复失败」
const RESTORE_TIMEOUT_MS = 10000
// 单设备会话心跳间隔：前台切换（useDidShow）之外，定时比对令牌以更快发现被挤下线
const SESSION_CHECK_INTERVAL_MS = 60000

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
  // 本设备会话被其他设备登录挤下线时的「另一设备登录时刻」；非 null 时弹出强制下线通知
  forcedOfflineAt: string | null
}

const UserContext = createContext<UserContextValue | undefined>(undefined)

export function UserProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [restoreFailed, setRestoreFailed] = useState(false)
  const [forcedOfflineAt, setForcedOfflineAt] = useState<string | null>(null)

  // 设置会话并（当会话存在时）把本机登记为当前活跃会话（覆写 profiles.session_token），
  // 使单设备会话生效：后登录设备会挤掉先登录设备
  const applySession = useCallback((next: Session | null) => {
    setSession(next)
    if (next) void establishSession(supabase)
  }, [])

  // 比对本地令牌与 DB 当前令牌；被挤下线则清会话 + 弹通知
  const checkNow = useCallback(async () => {
    if (!session || forcedOfflineAt) return
    try {
      const { kicked, startedAt } = await verifySession(supabase)
      if (kicked) {
        setForcedOfflineAt(startedAt)
        setSession(null)
        clearSessionToken()
        void supabase.auth.signOut({ scope: 'local' }).catch(() => {})
      }
    } catch {
      // 查询异常不判定为被踢，避免误伤
    }
  }, [session, forcedOfflineAt])

  // 始终指向最新 checkNow，供定时器的闭包读取
  const checkNowRef = useRef(checkNow)
  checkNowRef.current = checkNow

  // 前台切换即核对（设备 B 登录后，设备 A 回到前台立即发现被挤下线）
  useDidShow(() => {
    void checkNow()
  })

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
          applySession(data.session)
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
      applySession(nextSession)
    })

    // 心跳兜底：前台之外定时核对，缩短「后台被踢、回到前台才察觉」的窗口
    const intervalId = setInterval(() => {
      void checkNowRef.current()
    }, SESSION_CHECK_INTERVAL_MS)

    return () => {
      mounted = false
      clearInterval(intervalId)
      sub.subscription.unsubscribe()
    }
  }, [applySession])

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
    () => ({ session, user, ready, restoreFailed, forcedOfflineAt }),
    [session, user, ready, restoreFailed, forcedOfflineAt]
  )

  return (
    <UserContext.Provider value={value}>
      {children}
      <ForceOfflineModal
        opened={!!forcedOfflineAt}
        at={forcedOfflineAt}
        onClose={() => setForcedOfflineAt(null)}
      />
    </UserContext.Provider>
  )
}

export function useUser() {
  const ctx = useContext(UserContext)
  if (!ctx) {
    throw new Error('useUser 必须在 UserProvider 内部使用')
  }
  return ctx
}
