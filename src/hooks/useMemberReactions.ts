import { useCallback, useEffect, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { useT } from '@/i18n'
import { notifySingleUserCacheChange, singleUserCache } from '@/hooks/useProfiles'
import { REACTION_INT_MAX } from '@/lib/reaction-count'

export type ReactionKind = 'likes' | 'flowers'

/** 一次 RPC 最多带多少增量（与服务端 add_member_reactions 的上限一致） */
export const REACTION_MAX_DELTA = 100
/** 连续点击时最多每 1.5s 发一次 RPC；停手后同样在 1.5s 内落库 */
export const REACTION_FLUSH_DELAY_MS = 1500
const REACTION_MAX_RETRY_DELAY_MS = 8000

type Counts = { likes: number; flowers: number }
const ZERO: Counts = { likes: 0, flowers: 0 }

type RpcResult = {
  ok?: boolean
  likes?: number
  flowers?: number
  code?: string
}

/**
 * 成员点赞/送花：**本地即时计数 + 批量落库**。
 *
 * 交互要求：每次点击都要立刻 +1 并飘图标；远程调用要合并，不能点一下打一次 RPC。
 * 做法是维护两本账：
 *   · `confirmed`：服务端最后一次确认的绝对值
 *   · `pending`：尚未被服务端确认的增量（包含正在飞的那一批）
 * 展示 = confirmed + pending；成功时用 RPC 返回的绝对值覆盖 confirmed，并从 pending
 * 里扣掉**这一批实际发出去的**增量——飞行期间新增的点击仍留在 pending 里，不会丢，
 * 也不会在响应回来时先掉一下数字。
 *
 * 失败时 pending 原样保留并退避重试；连续失败 3 次提示一次。卸载 / 进后台时立即
 * flush（fire-and-forget），保证刚点的几下不会因为马上返回而丢失。
 */
export function useMemberReactions({
  targetUserId,
  initialLikes,
  initialFlowers,
}: {
  targetUserId: string
  initialLikes: number | null | undefined
  initialFlowers: number | null | undefined
}) {
  const { t } = useT()
  const [confirmed, setConfirmed] = useState<Counts>(() => ({
    likes: Math.max(0, initialLikes ?? 0),
    flowers: Math.max(0, initialFlowers ?? 0),
  }))
  const [pending, setPending] = useState<Counts>(ZERO)

  // 镜像给异步回调读最新值（flush 不随每次点击重建）
  const confirmedRef = useRef(confirmed)
  confirmedRef.current = confirmed
  const pendingRef = useRef(pending)
  pendingRef.current = pending

  const inFlightRef = useRef(false)
  const flushAfterInFlightRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const failuresRef = useRef(0)
  const toastShownRef = useRef(false)
  /** 指向最新的 flush（卸载/进后台的 cleanup 不能捕获旧闭包） */
  const flushRef = useRef<(unmounted: boolean) => Promise<void>>(async () => {})

  const scheduleFlush = useCallback((delay: number) => {
    if (timerRef.current) return
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void flushRef.current(false)
    }, delay)
  }, [])

  const updateSingleUserCache = useCallback(
    (likes: number, flowers: number) => {
      const rows = singleUserCache.get(targetUserId)
      if (!rows?.length) return
      singleUserCache.set(
        targetUserId,
        rows.map((row) => ({ ...row, likes_count: likes, flowers_count: flowers }))
      )
      notifySingleUserCacheChange(targetUserId)
    },
    [targetUserId]
  )

  const flush = useCallback(
    async (unmounted: boolean) => {
      if (inFlightRef.current) {
        flushAfterInFlightRef.current = true
        return
      }
      const queued = pendingRef.current
      const sent: Counts = {
        likes: Math.min(queued.likes, REACTION_MAX_DELTA),
        flowers: Math.min(queued.flowers, REACTION_MAX_DELTA),
      }
      if (sent.likes === 0 && sent.flowers === 0) return

      inFlightRef.current = true
      let ok = false
      let result: RpcResult | null = null
      try {
        const res = await supabase.rpc('add_member_reactions', {
          p_target_user_id: targetUserId,
          p_likes: sent.likes,
          p_flowers: sent.flowers,
        })
        result = (res.data ?? null) as RpcResult | null
        ok = !res.error && !!result?.ok
      } catch {
        ok = false
      } finally {
        inFlightRef.current = false
      }

      if (ok && result) {
        const nextConfirmed: Counts = {
          likes:
            typeof result.likes === 'number'
              ? result.likes
              : confirmedRef.current.likes + sent.likes,
          flowers:
            typeof result.flowers === 'number'
              ? result.flowers
              : confirmedRef.current.flowers + sent.flowers,
        }
        // 只扣掉这一批实际发出去的；飞行期间的新点击留在 pending
        const nextPending: Counts = {
          likes: Math.max(0, pendingRef.current.likes - sent.likes),
          flowers: Math.max(0, pendingRef.current.flowers - sent.flowers),
        }
        confirmedRef.current = nextConfirmed
        pendingRef.current = nextPending
        if (!unmounted && mountedRef.current) {
          setConfirmed(nextConfirmed)
          setPending(nextPending)
        }
        failuresRef.current = 0
        toastShownRef.current = false
        updateSingleUserCache(nextConfirmed.likes, nextConfirmed.flowers)
      } else {
        failuresRef.current += 1
        if (
          !unmounted &&
          mountedRef.current &&
          failuresRef.current >= 3 &&
          !toastShownRef.current
        ) {
          toastShownRef.current = true
          void Taro.showToast({ title: t('reactions.failed'), icon: 'none' })
        }
      }

      const hasPending = pendingRef.current.likes + pendingRef.current.flowers > 0
      if (!hasPending && !flushAfterInFlightRef.current) return

      if (unmounted || !mountedRef.current) {
        // 页面已经走了：把飞行期间新增的那几下补发一次，不再退避
        if (flushAfterInFlightRef.current) {
          flushAfterInFlightRef.current = false
          void flushRef.current(true)
        }
        return
      }

      flushAfterInFlightRef.current = false
      const delay = ok
        ? REACTION_FLUSH_DELAY_MS
        : Math.min(
            REACTION_MAX_RETRY_DELAY_MS,
            REACTION_FLUSH_DELAY_MS * 2 ** Math.min(failuresRef.current, 3)
          )
      scheduleFlush(delay)
    },
    [scheduleFlush, t, targetUserId, updateSingleUserCache]
  )

  flushRef.current = flush

  const bump = useCallback(
    (kind: ReactionKind) => {
      const next = { ...pendingRef.current, [kind]: pendingRef.current[kind] + 1 }
      pendingRef.current = next
      setPending(next)
      scheduleFlush(REACTION_FLUSH_DELAY_MS)
    },
    [scheduleFlush]
  )

  // 服务端在别处刷新了计数（心跳 / 成员详情重新拉取）：没有本地欠账时采纳服务端值。
  // 计数只增不减；一次慢的旧查询可能与刚入账的本地 RPC 交错（旧值比 confirmed 小），
  // 取较大值避免把刚点出来的数字压回去。
  useEffect(() => {
    if (pendingRef.current.likes + pendingRef.current.flowers > 0 || inFlightRef.current) return
    const next = {
      likes: Math.max(confirmedRef.current.likes, Math.max(0, initialLikes ?? 0)),
      flowers: Math.max(confirmedRef.current.flowers, Math.max(0, initialFlowers ?? 0)),
    }
    confirmedRef.current = next
    setConfirmed(next)
  }, [initialFlowers, initialLikes])

  // 卸载：先把欠账发出去（页面可能马上返回，不能等 1.5s 的定时器）
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      void flushRef.current(true)
    }
  }, [])

  // 进后台同样补发一次；定时器在后台可能被节流
  useEffect(() => {
    const onHide = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      void flushRef.current(false)
    }
    Taro.onAppHide?.(onHide)
    return () => {
      Taro.offAppHide?.(onHide)
    }
  }, [])

  return {
    likes: Math.min(confirmed.likes + pending.likes, REACTION_INT_MAX),
    flowers: Math.min(confirmed.flowers + pending.flowers, REACTION_INT_MAX),
    bump,
  }
}
