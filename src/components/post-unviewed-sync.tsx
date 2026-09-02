import { useEffect, useRef } from 'react'
import { usePosts } from '@/hooks/usePosts'
import { useUser } from '@/context/user-context'
import { parseLocalISO } from '@/lib/date-utils'
import {
  getCommunityDismissedAt,
  isCommunityDotOn,
  subscribePostSeen,
  setPostUnviewedFlag,
} from '@/lib/postSeen'

/**
 * 挂载于 App 根（与 NotificationBadgeSync 同层）：冷启动即拉取公告列表，
 * 计算「社区」底边栏红点——点亮 ⇔ 最新公告 created_at 晚于「最近一次点击社区」
 * 的消除时间戳（postSeen.getCommunityDismissedAt）。点击社区即消、新公告到达
 * （created_at 更晚）自然重新点亮；打开单帖不再影响底边栏红点。
 * 公告列表变化 / 点击消除（dismissCommunityDot）都会经 subscribePostSeen 触发重算。
 *
 * 注意：必须等会话就绪（ready / user 出现）后再确认一次，原因与
 * NotificationBadgeSync 一致——冷启动空结果由会话就绪后的重拉修正。
 */
export function PostUnviewedSync() {
  const { data, fetch } = usePosts()
  const { user, ready } = useUser()

  // 用 ref 追踪最新 data，避免 data 变化导致重新订阅
  const dataRef = useRef(data)
  dataRef.current = data

  // 会话就绪后重新拉取，修正冷启动空结果（镜像 NotificationBadgeSync 的 refresh 时机）
  useEffect(() => {
    if (ready || user?.id) void fetch()
  }, [ready, user?.id, fetch])

  // 只订阅一次，compute 内部通过 ref 读取最新 data
  useEffect(() => {
    const compute = () => {
      const latest = dataRef.current.reduce((max, p) => {
        if (!p.created_at) return max
        const ts = parseLocalISO(p.created_at).getTime()
        return Number.isNaN(ts) ? max : Math.max(max, ts)
      }, 0)
      setPostUnviewedFlag(isCommunityDotOn(latest || null, getCommunityDismissedAt('bar')))
    }
    compute()
    const unsub = subscribePostSeen(compute)
    return unsub
  }, [])

  return null
}
