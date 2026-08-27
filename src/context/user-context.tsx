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
import Taro, { useDidShow } from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'
import {
  clearSessionToken,
  establishSession,
  getStoredSessionToken,
  verifySession,
} from '@/lib/single-session'
import { logDiag, setSessionStatusProvider, startSessionDiag } from '@/lib/session-diag'
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
  // 控制「被其他设备挤下线」弹窗显隐的独立布尔：与 forcedOfflineAt（另一设备登录时刻，可为
  // null）解耦，确保即便 startedAt 为空弹窗也照常弹出，不会因 !!null 而永不显示
  const [forcedOffline, setForcedOffline] = useState(false)

  // 镜像最新状态：诊断心跳提供者注册一次即可读到最新值，避免闭包过期
  const sessionRef = useRef(session)
  sessionRef.current = session
  const readyRef = useRef(ready)
  readyRef.current = ready
  // 已登记为活跃会话的 access_token：同一会话只 touch_session 一次，避免 restore /
  // onAuthStateChange / token 刷新等事件并发重复调用，导致本地令牌与 DB 令牌不一致而被
  // 自己「挤下线」（自踢）
  const establishedTokenRef = useRef<string | null>(null)
  // 本设备被挤下线的「另一设备登录时刻」镜像（见 kick）；新会话建立时必须复位，否则卡死
  const forcedOfflineAtRef = useRef<string | null>(null)
  // 是否已弹过强制下线通知（去重 + 控制弹窗显隐），与时刻无关，避免 startedAt 为空时漏弹
  const forcedOfflineRef = useRef(false)

  // 设置会话并（当会话存在时）把本机登记为当前活跃会话（覆写 profiles.session_token），
  // 使单设备会话生效：后登录设备会挤掉先登录设备
  const applySession = useCallback((next: Session | null) => {
    if (next) {
      // 新会话建立：清掉上一次「被其他设备登录挤下线」的卡死标记。否则 forcedOfflineAtRef
      // 永不复位，心跳会一直报 forcedOffline=true、checkNow 早退不再校验，登录后也恢复不了
      forcedOfflineAtRef.current = null
      setForcedOfflineAt(null)
      forcedOfflineRef.current = false
      setForcedOffline(false)
      // 同一会话只 establish 一次（见 establishedTokenRef 注释），防止并发自踢
      if (next.access_token && next.access_token === establishedTokenRef.current) {
        setSession(next)
        return
      }
      establishedTokenRef.current = next.access_token ?? null
    } else {
      establishedTokenRef.current = null
    }
    setSession(next)
    if (next) void establishSession(supabase)
  }, [])

  // 诊断：注册心跳状态提供者并启动日志（幂等）
  useEffect(() => {
    setSessionStatusProvider(() => {
      const s = sessionRef.current
      return {
        ready: readyRef.current,
        hasSession: !!s,
        userId8: s?.user.id.slice(0, 8) ?? null,
        expiresInSec:
          typeof s?.expires_at === 'number'
            ? Math.round(s.expires_at - Date.now() / 1000)
            : null,
        localToken8: getStoredSessionToken()?.slice(0, 8) ?? null,
        forcedOffline: !!forcedOfflineAtRef.current,
      }
    })
    startSessionDiag()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 本设备被挤下线的统一处理：记录时刻、弹通知、清本机会话令牌、跳登录页、本地登出
  const kick = useCallback(
    (startedAt: string | null) => {
      if (forcedOfflineRef.current) return
      forcedOfflineRef.current = true
      // forcedOfflineAtRef 仅作「是否已处理」标志，startedAt 可能为空，用哨兵值保证 truthy
      forcedOfflineAtRef.current = startedAt ?? 'kicked'
      logDiag('forced_offline', {
        otherDeviceStartedAt: startedAt,
        localToken8: getStoredSessionToken()?.slice(0, 8) ?? null,
      })
      // 先弹「被其他设备挤下线」通知（显隐用独立布尔 forcedOffline，与 startedAt 是否为空解耦），
      // 并立即跳登录页卸载当前已登录页面：否则下方 applySession(null) 置空会话时，未加 user?.
      // 守卫的页面读取 user.id 会抛错，触发最外层 ErrorBoundary 把整棵子树（含本弹窗）替换为错误页，
      // 导致既无弹窗也无登录页。
      setForcedOffline(true)
      setForcedOfflineAt(startedAt)
      clearSessionToken()
      Taro.reLaunch({ url: '/pages/login/index' })
        .then(() => {
          applySession(null)
          void supabase.auth.signOut({ scope: 'local' }).catch(() => {})
        })
        .catch(() => {
          applySession(null)
          void supabase.auth.signOut({ scope: 'local' }).catch(() => {})
        })
    },
    [applySession]
  )

  // 比对本地令牌与 DB 当前令牌；被挤下线则清会话 + 弹通知
  const checkNow = useCallback(async () => {
    if (!session || forcedOfflineAtRef.current) return
    // 主动续期：临近过期（≤2 分钟）时刷新令牌。挂机久了微信会节流 JS 定时器，
    // supabase 自带刷新也可能不触发；这里在我们的 60s 心跳里兜底续期，避免 access
    // token 静默失效导致请求拿到空数据 / 静默登出。续期成功会触发 TOKEN_REFRESHED。
    const exp = session?.expires_at
    if (typeof exp === 'number' && Date.now() / 1000 >= exp - 120) {
      logDiag('token_refresh_attempt', { expiresInSec: Math.round(exp - Date.now() / 1000) })
      void supabase.auth.refreshSession().catch(() => {})
    }
    try {
      const { kicked, startedAt } = await verifySession(supabase)
      if (kicked) kick(startedAt)
    } catch (err) {
      logDiag('verify_error', { err: err instanceof Error ? err.message : String(err) })
    }
  }, [session, kick])

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
      logDiag('restore_begin')
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
        logDiag('restore_ok', { hasSession: !!data.session })
      } catch (err) {
        if (!mounted) return
        // 事件已给出会话时不降级（超时只是 getSession 未返回，会话仍可用）
        if (!eventArrived) {
          setSession(null)
          setRestoreFailed(true)
        }
        logDiag('restore_failed', {
          timeout: err instanceof Error && err.message === '会话恢复超时',
          err: err instanceof Error ? err.message : String(err),
        })
      } finally {
        if (timeoutId) clearTimeout(timeoutId)
        if (mounted) setReady(true)
      }
    }
    void init()

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return
      eventArrived = true
      logDiag('auth_event', {
        event: _event,
        hasSession: !!nextSession,
        userId8: nextSession?.user?.id.slice(0, 8) ?? null,
      })
      // 会话结束（SIGNED_OUT）只清本地状态，不再弹「已在其他设备登录」：
      // 自然过期 / 被服务端清理与会话被其他设备注销难以区分——而本模型下「被其他设备登录」
      // 只会覆写 profiles.session_token、auth.sessions 仍存活，可由 checkNow 的 verifySession
      // 走「有效令牌 + DB 令牌不符」分支精确判定并弹窗。此处若对已失效会话再调 signOut，
      // 会触发 session_not_found（JWT 的 session_id 已无对应记录）报错。
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
  }, [applySession, kick])

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
        opened={forcedOffline}
        at={forcedOfflineAt}
        onClose={() => {
          forcedOfflineRef.current = false
          forcedOfflineAtRef.current = null
          setForcedOffline(false)
          setForcedOfflineAt(null)
        }}
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
