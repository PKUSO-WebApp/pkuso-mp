import { useCallback, useEffect, useRef, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { useUser } from '@/context/user-context'

export type LeadershipPosition = 'president' | 'vice_president' | null

const storageKey = (userId: string) => `pkuso_leadership_position_v1:${userId}`

// 模块级缓存：同一账号的多个页面共享一次请求结果
const cache = new Map<string, LeadershipPosition>()
const subscribers = new Map<string, Set<() => void>>()
const inflight = new Map<string, Promise<void>>()

function normalize(value: unknown): LeadershipPosition {
  return value === 'president' || value === 'vice_president' ? value : null
}

/** undefined = 本地没有缓存；null = 明确缓存了「无职位」 */
function readStored(userId: string): LeadershipPosition | undefined {
  try {
    const raw = Taro.getStorageSync(storageKey(userId))
    if (!raw) return undefined
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return normalize(parsed)
  } catch {
    return undefined
  }
}

function getCached(userId: string): LeadershipPosition | undefined {
  if (cache.has(userId)) return cache.get(userId)
  const stored = readStored(userId)
  if (stored !== undefined) cache.set(userId, stored)
  return stored
}

function writeCache(userId: string, position: LeadershipPosition) {
  cache.set(userId, position)
  try {
    Taro.setStorageSync(storageKey(userId), JSON.stringify(position))
  } catch {
    // 本地缓存写失败只影响下一次冷启动的首帧，不影响本次结果
  }
  subscribers.get(userId)?.forEach((cb) => cb())
}

async function fetchPosition(userId: string): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('my_leadership_position')
    if (error) {
      // 失败保留缓存：一次网络抖动不该把副团长标题变回通用文案
      console.error('[LeadershipPosition] 拉取职位失败', error.message)
      return
    }
    writeCache(userId, normalize(data))
  } catch (err) {
    console.error('[LeadershipPosition] 拉取职位异常', err)
  }
}

/**
 * 当前账号的团级职位（president / vice_president / null）。
 * 缓存优先，供「我的」页工作台标题使用；权限入口仍由 useMyCapabilities 决定。
 */
export function useMyLeadershipPosition() {
  const { user } = useUser()
  const userId = user?.id
  const initial = userId ? getCached(userId) : undefined
  const [position, setPosition] = useState<LeadershipPosition>(initial ?? null)
  const [loading, setLoading] = useState(userId ? initial === undefined : false)
  const mountedRef = useRef(true)
  const currentUserIdRef = useRef(userId)
  currentUserIdRef.current = userId

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!userId) {
      setPosition(null)
      setLoading(false)
      return
    }
    const cached = getCached(userId)
    setPosition(cached ?? null)
    setLoading(cached === undefined)

    let set = subscribers.get(userId)
    if (!set) {
      set = new Set()
      subscribers.set(userId, set)
    }
    const cb = () => {
      setPosition(cache.get(userId) ?? null)
      setLoading(false)
    }
    set.add(cb)
    return () => {
      set.delete(cb)
      if (set.size === 0) subscribers.delete(userId)
    }
  }, [userId])

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!userId) return
      const hasCache = cache.has(userId)
      if (!opts?.silent && !hasCache) setLoading(true)

      let task = inflight.get(userId)
      if (!task) {
        task = fetchPosition(userId).finally(() => {
          inflight.delete(userId)
        })
        inflight.set(userId, task)
      }
      try {
        await task
      } finally {
        if (mountedRef.current && currentUserIdRef.current === userId) {
          setLoading(false)
        }
      }
    },
    [userId]
  )

  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useDidShow(() => {
    void refreshRef.current({ silent: true })
  })

  useEffect(() => {
    if (!userId) return
    void refresh({ silent: cache.has(userId) })
  }, [refresh, userId])

  return { position, loading }
}
