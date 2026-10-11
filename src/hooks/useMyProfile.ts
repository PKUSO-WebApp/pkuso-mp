import { useEffect, useState } from 'react'
import { useUser } from '@/context/user-context'
import {
  singleUserCache,
  singleUserCacheLoading,
  subscribeSingleUserCache,
  useProfiles,
} from '@/hooks/useProfiles'
import type { ProfileRow } from '@/types/database'

export type MyProfileResult = {
  /** 当前登录用户的 profile（未加载完成或查询失败时为 null） */
  profile: ProfileRow | null
  /** profile 是否还没到手（缓存冷 + 正在拉）——页面据此显示 loading，别把"还不知道"当成"没有" */
  loading: boolean
}

/**
 * 当前登录用户的 profile：**自己保证把数据拉到手**，再订阅模块级缓存（修改声部后即时生效）。
 *
 * ⚠️ **fetch 的时机 = 第一个需要它的页面挂载时**（2026-10-11 修）。从前这里只「读缓存 +
 * 订阅」，于是「谁先访问过 profile 页 / 花名册」成了拿到数据的前提：新装或冷启动直接进谱务页时
 * 缓存是空的，`profile.instrument` 读成空串 —— 用户看到的是「分发给我的」永远空。
 *
 * 做法是**挂一份 `useProfiles({ userId })`**（不用它的返回值）：profile 的加载入口只有那一个
 * 单用户分支，它自带「缓存优先 + `singleUserCacheLoading` 去重 + 写缓存后通知订阅者」。
 * 缓存已热时它一个请求都不发，所以后到的页面全是命中，同一会话只付一次。
 * 刻意**不做**「登录后就预取」：多一次请求，而多数会话根本用不到 profile。
 *
 * ⚠️ 传给 `useProfiles` 的必须是 `{ userId }` 这个**带键**的对象（哪怕值是 undefined）：
 * 它用「显式 undefined」区分「未就绪，别查」与「没传 userId ⇒ 查全表」。写成 `useProfiles()`
 * 会在未登录时退化成全表查询，拿到的可能是别人的行（各页那句「游客分支必须排在
 * useMyProfile 之前」的注释就是这个来历）。
 */
export function useMyProfile(): MyProfileResult {
  const { user } = useUser()
  const userId = user?.id

  // 只为「把 profile 拉进缓存」而挂（返回值不用）——见上面的注释
  useProfiles({ userId })

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
      // 缓存冷：马上会有人去拉（本 hook 挂的那份 useProfiles），先如实说"还没到手"
      setLoading(true)
    }

    // 订阅缓存变更
    const unsubscribe = subscribeSingleUserCache(userId, () => {
      const updated = singleUserCache.get(userId)
      setProfile(updated?.[0] ?? null)
      // ⚠️ 只有「缓存到手」才算加载完。拉取开始时也会通知一次（那时缓存仍为空），
      // 若在这里无条件 setLoading(false)，界面会在请求在途中就先显示空态
      // ——正是「永远显示声部没有谱子」的另一种形态。拉取失败同理：标记被清掉 ⇒ 空态。
      setLoading(!updated && singleUserCacheLoading.get(userId) === true)
    })

    return unsubscribe
  }, [userId])

  return { profile, loading }
}
