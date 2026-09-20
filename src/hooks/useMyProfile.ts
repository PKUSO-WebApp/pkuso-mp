import { useEffect, useState } from 'react'
import { useUser } from '@/context/user-context'
import { singleUserCache, subscribeSingleUserCache } from '@/hooks/useProfiles'
import type { ProfileRow } from '@/types/database'

export type MyProfileResult = {
  /** 当前登录用户的 profile（未加载完成或查询失败时为 null） */
  profile: ProfileRow | null
  /** profile 查询是否进行中 */
  loading: boolean
}

/**
 * 当前登录用户的 profile（直接读取模块级缓存并订阅变更，确保修改声部后即时生效）。
 */
export function useMyProfile(): MyProfileResult {
  const { user } = useUser()
  const userId = user?.id

  // 直接从缓存读取初始值
  const [profile, setProfile] = useState<ProfileRow | null>(
    userId ? (singleUserCache.get(userId)?.[0] ?? null) : null
  )
  const [loading, setLoading] = useState(true)

  // 订阅缓存变更
  useEffect(() => {
    if (!userId) {
      setProfile(null)
      setLoading(false)
      return
    }

    // 检查缓存是否已有数据
    const cached = singleUserCache.get(userId)
    if (cached) {
      setProfile(cached[0] ?? null)
      setLoading(false)
    } else {
      setLoading(true)
    }

    // 订阅缓存变更
    const unsubscribe = subscribeSingleUserCache(userId, () => {
      const updated = singleUserCache.get(userId)
      setProfile(updated?.[0] ?? null)
      setLoading(false)
    })

    return unsubscribe
  }, [userId])

  return { profile, loading }
}
