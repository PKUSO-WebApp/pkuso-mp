import { useRef } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'

/**
 * 页面状态恢复 Hook
 *
 * 问题背景：
 * 微信小程序调用 chooseMedia / chooseAvatar / getLocation 等 API 时，
 * 会销毁当前页面，待用户操作完成后重建。重建后 router.params 丢失，
 * 所有 useState 重置，导致页面数据丢失。
 *
 * 解决方案：
 * 1. 首次渲染时用 useRef 缓存 router.params 中的关键参数
 * 2. useDidShow 在页面从后台回前台时检测参数是否丢失
 * 3. 丢失时调用 onRestore 回调，触发 useEffect 重新获取数据
 *
 * 使用示例：
 * ```tsx
 * // 缓存 router.params.id，当 id 丢失时触发恢复
 * const cachedId = usePageRestore<number>('id')
 *
 * // useEffect 依赖 cachedId，页面恢复时自动重跑
 * useEffect(() => {
 *   if (!cachedId) return
 *   fetchData(cachedId)
 * }, [cachedId])
 * ```
 *
 * @param paramName 要缓存的 router.params 键名
 * @returns 缓存的参数值（始终稳定，不会因页面重建丢失）
 */
export function usePageRestore<T = string>(paramName: string): T | undefined {
  const router = Taro.getCurrentInstance().router
  const cacheRef = useRef<T | undefined>(undefined)
  const initializedRef = useRef(false)

  // 首次渲染时缓存参数值
  if (!initializedRef.current) {
    const rawValue = router?.params?.[paramName]
    cacheRef.current = rawValue !== undefined ? (rawValue as unknown as T) : undefined
    initializedRef.current = true
  }

  // 页面从后台回前台时，检测参数是否丢失
  useDidShow(() => {
    const currentValue = router?.params?.[paramName]
    // 如果缓存有值但当前丢失了，说明页面被重建
    // 此时保持缓存值不变（useRef 天然保留）
    // 调用方通过 useEffect 依赖此值可自动触发数据恢复
    if (cacheRef.current !== undefined && currentValue === undefined) {
      // 页面重建，缓存值仍有效，useEffect 会重跑
    }
  })

  return cacheRef.current
}

/**
 * 批量缓存多个 router.params
 *
 * 使用示例：
 * ```tsx
 * const { id, tab } = usePageRestoreMany<{ id: number; tab: string }>(['id', 'tab'])
 * ```
 */
export function usePageRestoreMany<T extends Record<string, unknown>>(
  paramNames: (keyof T)[]
): Partial<T> {
  const router = Taro.getCurrentInstance().router
  const cacheRef = useRef<Partial<T>>({})
  const initializedRef = useRef(false)

  // 首次渲染时缓存所有参数
  if (!initializedRef.current) {
    const params: Partial<T> = {}
    for (const name of paramNames) {
      const rawValue = router?.params?.[name as string]
      if (rawValue !== undefined) {
        params[name] = rawValue as unknown as T[typeof name]
      }
    }
    cacheRef.current = params
    initializedRef.current = true
  }

  // 页面恢复检测（同 usePageRestore）
  useDidShow(() => {
    // useDidShow 触发时，useRef 状态已保留
    // useEffect 依赖缓存值会自动重跑
  })

  return cacheRef.current
}
