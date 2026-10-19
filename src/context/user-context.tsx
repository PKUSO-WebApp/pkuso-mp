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
  clearLegacySessionToken,
  touchSession,
  verifySession,
  type SessionKickKind,
} from '@/lib/device-session'
import { getOrCreateDeviceId } from '@/lib/device-id'
import { isRetryableAuthError } from '@/lib/auth-errors'
import { logDiag, setSessionStatusProvider, startSessionDiag } from '@/lib/session-diag'
import { __resetRehearsalsCache } from '@/hooks/useRehearsals'
import { setLoggedIn } from '@/lib/authStore'

// 会话恢复超时阈值：弱网/挂起时不再无限等待（SDK 默认等待较长），超时降级为「未登录 + 恢复失败」
const RESTORE_TIMEOUT_MS = 10000
// 设备会话自查间隔：前台切换（useDidShow）之外，定时自查本设备是否被设为不信任。
// 15s：前台空闲最坏检测延迟约 15s（更短会显著增加 RPC 频次，收益递减）
const SESSION_CHECK_INTERVAL_MS = 15000

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
  // 本设备被拒绝登录（被设为不信任）：在线被踢下线、登录/冷启动被服务端拒绝，都是这一条
  forcedOffline: boolean
  // 被踢下线的两种原因（'rejected' 被设为不信任 / 'deleted' 被删除设备），弹窗据此选文案；
  // null = 当前没有这条下线，或原因未知（弹窗按 'rejected' 兜底）
  forcedOfflineKind: SessionKickKind | null
  // 登录链路自己发现被拒（touch_session_v2 返回 device_rejected）时置位，复用同一条弹窗。
  // 该 RPC 只在一行「不信任且无墓碑」时拒绝 ⇒ 省略 kind 时按 'rejected' 处理
  markForcedOffline: (kind?: SessionKickKind) => void
  /**
   * **把本机踢下线**：与 15 秒轮询发现被踢时走的是同一条链路（清会话 → 回登录页 → 弹窗）。
   *
   * 给「设备管理前的自查」用（2026-10-16 用户定，规则 C）：在 `devices` 页操作别的设备之前
   * 先查自己还在不在受信名单里，发现自己已被设为不信任 / 已被删除就**直接踢出** ——
   * 那台设备本来就已经不可信了，把它留在页面上继续点按钮没有任何意义。
   */
  kickSelf: (kind: SessionKickKind) => void
  // 关闭强制下线弹窗（仅在登录页渲染，供用户确认后复位）
  clearForcedOffline: () => void
  /**
   * 重试冷启动会话恢复。
   *
   * 首次恢复超时（RESTORE_TIMEOUT_MS）时 `ready` 已经是 true、`restoreFailed` 也是 true，
   * 但用户实际上可能登录着——直接把他送去登录页会让弱网用户白白重登。页面应展示
   * 「加载失败，重试」，由本方法再跑一次 getSession：成功则 user 回填，失败则保持
   * restoreFailed（页面继续可重试）；确认没有会话时才清 restoreFailed，交给守卫跳登录。
   */
  retryRestore: () => Promise<void>
}

const UserContext = createContext<UserContextValue | undefined>(undefined)

// 走强制下线链路的原因，只用于诊断日志
type KickReason = 'verify' | 'touch_rejected' | 'admin_check'

export function UserProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [restoreFailed, setRestoreFailed] = useState(false)
  // 控制强制下线弹窗显隐（弹窗本体挂在登录页上）
  const [forcedOffline, setForcedOffline] = useState(false)
  // 这次下线的原因，只给弹窗选文案用
  const [forcedOfflineKind, setForcedOfflineKind] = useState<SessionKickKind | null>(null)

  // 镜像最新状态：诊断心跳提供者注册一次即可读到最新值，避免闭包过期
  const sessionRef = useRef(session)
  sessionRef.current = session
  const readyRef = useRef(ready)
  readyRef.current = ready
  // 已登记为活跃设备的 access_token：同一会话只 touch_session_v2 一次，避免 restore /
  // onAuthStateChange / token 刷新等事件并发重复调用
  const establishedTokenRef = useRef<string | null>(null)
  // 是否已处理过「被拒绝」：去重（kick 只走一次），新会话建立时必须复位，否则会一直卡住
  const forcedOfflineRef = useRef(false)
  // touch/establish 进行中标记：防止 RPC 期间 checkNow 读到新旧交替的中间态
  const establishingRef = useRef(false)

  // 本地会话复位：清会话状态与缓存。与「被拒绝」弹窗状态无关（那是 kick 的事）。
  const resetLocalSession = useCallback(() => {
    establishedTokenRef.current = null
    __resetRehearsalsCache()
    setSession(null)
    setLoggedIn(false)
    // 本地会话已经确定没了（SIGNED_OUT / 主动清空），之前那次「恢复失败」不再是
    // 需要用户处理的状态——各页据此把「网络异常，重试」切回登录守卫。
    setRestoreFailed(false)
  }, [])

  // 本设备被拒绝登录的统一处理：记录、弹通知、跳登录页、本地登出
  const kick = useCallback(
    (reason: KickReason, kind: SessionKickKind) => {
      if (forcedOfflineRef.current) return
      forcedOfflineRef.current = true
      logDiag('forced_offline', {
        reason,
        kind,
        deviceId8: getOrCreateDeviceId().slice(0, 8),
      })
      // 同步先置位（若 Provider 不因 reLaunch 重挂载，弹窗立即出现）；并延迟到 reLaunch 完成后
      // 再置位一次（reLaunch 在部分 Taro 配置下会让 UserProvider 重挂载，旧实例状态随之丢失，
      // 需在登录页新实例上重新置位，否则弹窗不出现）。见 force_offline_modal_render 诊断。
      // kind 与它同进同退：只置位一半会让弹窗按默认（rejected）出文案。
      setForcedOffline(true)
      setForcedOfflineKind(kind)
      clearLegacySessionToken()
      const openOnLogin = () => {
        logDiag('forced_offline_open', { reason, kind })
        setForcedOffline(true)
        setForcedOfflineKind(kind)
        resetLocalSession()
        void supabase.auth.signOut({ scope: 'local' }).catch(() => {})
      }
      Taro.reLaunch({ url: '/pages/login/index' }).then(openOnLogin).catch(openOnLogin)
    },
    [resetLocalSession]
  )

  // 关闭强制下线弹窗：复位卡死标记与显隐状态。弹窗由登录页在 forcedOffline 为真时就地渲染。
  const clearForcedOffline = useCallback(() => {
    forcedOfflineRef.current = false
    setForcedOffline(false)
    setForcedOfflineKind(null)
  }, [])

  // 登录链路自己发现被拒时置位（同一条弹窗）：此时已在登录页，不 reLaunch、不登出
  // （会话由登录链路自己撤销），只把通知弹出来。kind 默认 'rejected' —— device_rejected
  // 只在「不信任且未删除」时抛出（见 touch_session_v2），不存在另一种原因。
  const markForcedOffline = useCallback((kind: SessionKickKind = 'rejected') => {
    logDiag('forced_offline', { reason: 'login_rejected', kind })
    forcedOfflineRef.current = true
    setForcedOffline(true)
    setForcedOfflineKind(kind)
  }, [])

  /**
   * 设备管理前的自查发现本机已不可信 ⇒ 踢出（规则 C，见类型里的说明）。
   * `kick` 自带「只走一次」的守卫（`forcedOfflineRef`），重复调用是空操作。
   */
  const kickSelf = useCallback(
    (kind: SessionKickKind) => {
      kick('admin_check', kind)
    },
    [kick]
  )

  // 设置会话并（当会话存在时）登记本设备（touch_session_v2）：刷新本设备这一行。
  // 被设为不信任的设备在这里被服务端明确拒绝（device_rejected）⇒ 走强制下线链路。
  const applySession = useCallback(
    (next: Session | null) => {
      if (next) {
        // 新会话建立：清掉上一次「被拒绝」的卡死标记。否则 forcedOfflineRef 永不复位，
        // 心跳会一直报 forcedOffline=true、checkNow 早退不再校验，登录后也恢复不了。
        forcedOfflineRef.current = false
        setForcedOffline(false)
        setForcedOfflineKind(null)
        // 会话事件晚于恢复超时到达时，把它从「恢复失败」拉回正常态
        setRestoreFailed(false)
        // 同一会话只 touch 一次（见 establishedTokenRef 注释），防止并发重复调用
        if (next.access_token && next.access_token === establishedTokenRef.current) {
          setSession(next)
          setLoggedIn(true)
          return
        }
        establishedTokenRef.current = next.access_token ?? null
        setSession(next)
        setLoggedIn(true)
        establishingRef.current = true
        void touchSession(supabase)
          .then((res) => {
            // device_rejected 只在「不信任且未删除」时抛出 ⇒ 原因只能是 rejected
            if (res.rejected) kick('touch_rejected', 'rejected')
          })
          .finally(() => {
            establishingRef.current = false
          })
        return
      }
      resetLocalSession()
    },
    [kick, resetLocalSession]
  )

  // 冷启动恢复超时/网络异常后的手动重试（页面上的「重试」按钮）。
  // 与 init 的差别：不重新订阅 auth 事件（订阅只建一次），只补一次 getSession。
  const retryRestore = useCallback(async () => {
    logDiag('restore_retry')
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      const { data, error } = await Promise.race([
        supabase.auth.getSession(),
        new Promise<never>((_resolve, reject) => {
          timeoutId = setTimeout(() => reject(new Error('会话恢复超时')), RESTORE_TIMEOUT_MS)
        }),
      ])
      if (error) throw error
      // 事件可能已经先把会话带回来：只在当前没有会话时用 getSession 的结果覆盖，
      // 避免一次慢返回的 null 把刚恢复的会话抹掉。
      if (data.session) applySession(data.session)
      else if (!sessionRef.current) applySession(null)
      setRestoreFailed(false)
      logDiag('restore_retry_ok', { hasSession: !!data.session })
    } catch (err) {
      const retryable = isRetryableAuthError(err)
      if (retryable) {
        // 超时/网络类失败：保持「恢复失败」语义，页面继续显示可重试的错误态；
        // 不能在这里 applySession(null)——那会把一个可能有效的本地会话清掉。
        setRestoreFailed(true)
      } else {
        // refresh token 已失效 / session 已不存在：这是定论。清本地会话，
        // restoreFailed 归 false，页面守卫会跳登录，不再让用户空点重试。
        applySession(null)
        setRestoreFailed(false)
      }
      logDiag('restore_retry_failed', {
        err: err instanceof Error ? err.message : String(err),
        retryable,
      })
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      setReady(true)
    }
  }, [applySession])

  // 诊断：注册心跳状态提供者并启动日志（幂等）
  useEffect(() => {
    setSessionStatusProvider(() => {
      const s = sessionRef.current
      return {
        ready: readyRef.current,
        hasSession: !!s,
        userId8: s?.user.id.slice(0, 8) ?? null,
        expiresInSec:
          typeof s?.expires_at === 'number' ? Math.round(s.expires_at - Date.now() / 1000) : null,
        deviceId8: getOrCreateDeviceId().slice(0, 8),
        forcedOffline: !!forcedOfflineRef.current,
      }
    })
    startSessionDiag()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 自查本设备这一行：trusted=false 即强制下线（被设为不信任，或被「删除设备」）。
  // 旧的「本地令牌 ≠ DB 令牌」判据已随多设备模型退场（每设备一行，token 只标识那一行）。
  const checkNow = useCallback(async () => {
    if (!session || forcedOfflineRef.current || establishingRef.current) return
    // 主动续期：临近过期（≤2 分钟）时刷新令牌。挂机久了微信会节流 JS 定时器，
    // supabase 自带刷新也可能不触发；这里在我们的 15s 心跳里兜底续期，避免 access
    // token 静默失效导致请求拿到空数据 / 静默登出。续期成功会触发 TOKEN_REFRESHED。
    const exp = session?.expires_at
    if (typeof exp === 'number' && Date.now() / 1000 >= exp - 120) {
      logDiag('token_refresh_attempt', { expiresInSec: Math.round(exp - Date.now() / 1000) })
      void supabase.auth.refreshSession().catch(() => {})
    }
    try {
      const { kicked, kind } = await verifySession(supabase)
      // kind 为 null 只可能出现在「没被踢」那一支（被踢时一定有原因）；?? 兜住类型
      if (kicked) kick('verify', kind ?? 'rejected')
    } catch (err) {
      logDiag('verify_error', { err: err instanceof Error ? err.message : String(err) })
    }
  }, [session, kick])

  // 始终指向最新 checkNow，供定时器的闭包读取
  const checkNowRef = useRef(checkNow)
  checkNowRef.current = checkNow

  // 前台切换即核对（设备 B 把设备 A 设为不信任后，设备 A 回到前台立即发现）
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
        const { data, error } = await Promise.race([
          supabase.auth.getSession(),
          // 超时兜底：直接走降级分支，避免登录页长期挂起
          new Promise<never>((_resolve, reject) => {
            timeoutId = setTimeout(() => reject(new Error('会话恢复超时')), RESTORE_TIMEOUT_MS)
          }),
        ])
        if (!mounted) return
        if (!eventArrived) {
          // getSession 在刷新失败时会同时给出 error 与 session:null。
          // 那是「恢复失败」而不是「确定未登录」——不能走 applySession(null)，
          // 否则页面会把弱网用户当成游客送去登录页；交给 restoreFailed 显示重试。
          if (error) throw error
          applySession(data.session)
        }
        setRestoreFailed(false)
        logDiag('restore_ok', { hasSession: !!data.session })
      } catch (err) {
        if (!mounted) return
        const retryable = isRetryableAuthError(err)
        // 事件已给出会话时不降级（超时只是 getSession 未返回，会话仍可用）
        if (!eventArrived) {
          if (retryable) {
            // 超时/网络/5xx：用户可能其实登录着，保留「恢复失败」让页面提供重试
            setSession(null)
            setRestoreFailed(true)
          } else {
            // refresh token 已失效 / session 已不存在：定论失败，重试没有意义。
            // 清本地会话并归零 restoreFailed，守卫会直接跳登录。
            applySession(null)
            setRestoreFailed(false)
          }
        }
        logDiag('restore_failed', {
          timeout: err instanceof Error && err.message === '会话恢复超时',
          err: err instanceof Error ? err.message : String(err),
          retryable,
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
      // 会话结束（SIGNED_OUT）只清本地状态，不弹通知：自然过期 / 服务端清理 / 被设为不信任
      // 在这里分不开——被拒绝这件事由 applySession 的 touch 与 checkNow 的自查精确判定。
      applySession(nextSession)
    })

    // 心跳兜底：前台之外定时自查，缩短「后台被设为不信任、回到前台才察觉」的窗口
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
    () => ({
      session,
      user,
      ready,
      restoreFailed,
      forcedOffline,
      forcedOfflineKind,
      markForcedOffline,
      kickSelf,
      clearForcedOffline,
      retryRestore,
    }),
    [
      session,
      user,
      ready,
      restoreFailed,
      forcedOffline,
      forcedOfflineKind,
      markForcedOffline,
      kickSelf,
      clearForcedOffline,
      retryRestore,
    ]
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
