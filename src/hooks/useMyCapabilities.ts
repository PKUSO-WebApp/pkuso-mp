import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { supabase as defaultClient } from '@/lib/supabase'
import { useUser } from '@/context/user-context'

/**
 * 团长能力（与 backend `president_capability_keys()` 同一组，名称不可随意改）。
 *
 * `my_capabilities()` 只返回**显式授予**的团长能力；admin 不走这个 hook
 * （admin 的能力判据在 backend 的 `has_capability()` 里另行包含）。
 */
export const PRESIDENT_CAPABILITIES = [
  'rehearsal',
  'leave_approval',
  'membership_approval',
  'announcement',
  'attendance',
  'attendance_approval',
  'attendance_export',
] as const

export type PresidentCapability = (typeof PRESIDENT_CAPABILITIES)[number]

const CAPABILITY_SET = new Set<string>(PRESIDENT_CAPABILITIES)

/** 本地缓存按账号隔离；换账号不会读到上一个人的能力。 */
export const myCapabilitiesStorageKey = (userId: string) =>
  `pkuso_president_capabilities_v1:${userId}`

type MyCapabilitiesOptions = { silent?: boolean }

export type MyCapabilitiesResult = {
  /** 当前账号的团长能力；缓存优先，未加载完成时可能是空数组 */
  capabilities: PresidentCapability[]
  /** 没有缓存且首次请求尚未结束 */
  loading: boolean
  hasCapability: (capability: PresidentCapability) => boolean
  /** 手动刷新；失败时保留已有缓存，不把入口清空 */
  refresh: (opts?: MyCapabilitiesOptions) => Promise<void>
}

// 模块级缓存：同一账号的多个页面/组件共享一次请求结果。
const capabilityCache = new Map<string, PresidentCapability[]>()
const subscribers = new Map<string, Set<() => void>>()
const inflight = new Map<string, Promise<void>>()

function normalizeCapabilities(value: unknown): PresidentCapability[] {
  if (!Array.isArray(value)) return []
  const granted = new Set(
    value.filter((item): item is string => typeof item === 'string' && CAPABILITY_SET.has(item))
  )
  // 固定顺序：请求结果的顺序不参与 UI 判断，避免每次刷新造成无意义的重渲染
  return PRESIDENT_CAPABILITIES.filter((capability) => granted.has(capability))
}

function readStoredCapabilities(userId: string): PresidentCapability[] | null {
  try {
    const raw = Taro.getStorageSync(myCapabilitiesStorageKey(userId))
    if (!raw) return null
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return null
    return normalizeCapabilities(parsed)
  } catch {
    // 缓存损坏/存储不可用时当作没有缓存；后台 RPC 仍会补上
    return null
  }
}

function getCachedCapabilities(userId: string): PresidentCapability[] | null {
  const cached = capabilityCache.get(userId)
  if (cached) return cached

  const stored = readStoredCapabilities(userId)
  if (stored !== null) capabilityCache.set(userId, stored)
  return stored
}

function writeCachedCapabilities(userId: string, capabilities: PresidentCapability[]) {
  capabilityCache.set(userId, capabilities)
  try {
    Taro.setStorageSync(myCapabilitiesStorageKey(userId), JSON.stringify(capabilities))
  } catch (err) {
    // 本地缓存写失败只影响下次冷启动的首帧显隐，不影响本次结果
    console.warn('[MyCapabilities] 写入本地缓存失败', err)
  }
  notifySubscribers(userId)
}

function subscribeCapabilities(userId: string, cb: () => void) {
  let set = subscribers.get(userId)
  if (!set) {
    set = new Set()
    subscribers.set(userId, set)
  }
  set.add(cb)
  return () => {
    set.delete(cb)
    if (set.size === 0) subscribers.delete(userId)
  }
}

function notifySubscribers(userId: string) {
  subscribers.get(userId)?.forEach((cb) => cb())
}

async function fetchCapabilities(userId: string, client: typeof defaultClient): Promise<void> {
  try {
    const { data, error } = await client.rpc('my_capabilities')
    if (error) {
      // 网络/权限失败不能把缓存清空：否则一次抖动会把入口全部藏起来
      console.error('[MyCapabilities] 拉取能力失败', error.message)
      return
    }
    writeCachedCapabilities(userId, normalizeCapabilities(data))
  } catch (err) {
    console.error('[MyCapabilities] 拉取能力异常', err)
  }
}

/**
 * 团长能力读取：缓存优先，首帧即可决定入口显隐，不等待 RPC。
 *
 * - `my_capabilities()` 只返回显式能力；admin 不依赖本 hook
 * - 每次页面展示（`useDidShow`）静默刷新；失败保留缓存
 * - 同一账号并发请求在模块级去重
 * - 缓存按 userId 隔离，换账号不会泄漏上一个人的入口
 */
export function useMyCapabilities(
  client: typeof defaultClient = defaultClient
): MyCapabilitiesResult {
  const { user } = useUser()
  const userId = user?.id

  // 客户端引用放进 ref：调用方即使传了每次渲染都新建的测试替身，也不会让
  // refresh 的依赖变化 → effect 重跑 → setState → 再重跑的无限循环
  const clientRef = useRef(client)
  clientRef.current = client

  // 首次渲染直接读缓存；userId 尚未就绪时为空，等 effect 在账号就绪后补上
  const initialCache = userId ? getCachedCapabilities(userId) : null
  const [capabilities, setCapabilities] = useState<PresidentCapability[]>(initialCache ?? [])
  const [loading, setLoading] = useState(userId ? initialCache === null : false)

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
      setCapabilities([])
      setLoading(false)
      return
    }

    const cached = getCachedCapabilities(userId)
    setCapabilities(cached ?? [])
    setLoading(cached === null)

    const unsubscribe = subscribeCapabilities(userId, () => {
      const next = capabilityCache.get(userId) ?? []
      setCapabilities(next)
      setLoading(false)
    })

    return unsubscribe
  }, [userId])

  const refresh = useCallback(
    async (opts?: MyCapabilitiesOptions) => {
      if (!userId) return

      const hasCache = capabilityCache.has(userId)
      if (!opts?.silent && !hasCache) setLoading(true)

      let task = inflight.get(userId)
      if (!task) {
        task = fetchCapabilities(userId, clientRef.current).finally(() => {
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

  // 页面每次展示都静默刷新：团长被撤销/新增后，不需要杀进程也能在回到页面时纠正
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useDidShow(() => {
    void refreshRef.current({ silent: true })
  })

  // 挂载/切换账号时拉一次；有缓存时静默刷新，不覆盖首帧
  useEffect(() => {
    if (!userId) return
    void refresh({ silent: capabilityCache.has(userId) })
  }, [userId, refresh])

  const capabilitySet = useMemo(() => new Set(capabilities), [capabilities])
  const hasCapability = useCallback(
    (capability: PresidentCapability) => capabilitySet.has(capability),
    [capabilitySet]
  )

  return { capabilities, loading, hasCapability, refresh }
}

/** 测试用：清空模块级缓存；生产代码不应调用。 */
export function __resetMyCapabilitiesCache() {
  capabilityCache.clear()
  subscribers.clear()
  inflight.clear()
}
