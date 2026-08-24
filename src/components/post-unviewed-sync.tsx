import { useEffect } from 'react'
import { usePosts } from '@/hooks/usePosts'
import { useUser } from '@/context/user-context'
import { isPostSeen, subscribePostSeen, setPostUnviewedFlag } from '@/lib/postSeen'

/**
 * 挂载于 App 根（与 NotificationBadgeSync 同层）：冷启动即拉取公告列表，
 * 据此计算「社区」tab 红点（存在未查看帖子时点亮），使红点在进入小程序时即可判断，
 * 无需先打开社区页。帖子查看状态变化（markPostSeen）也即时重算，红点随之消失。
 * 帖子本身的 30s 心跳与「标记已读」由 usePosts + dataSync 负责，这里只消费结果。
 *
 * 注意：必须等会话就绪（ready / user 出现）后再确认一次未读，原因与
 * NotificationBadgeSync 一致——冷启动时 usePosts 的首次 fetch 可能在 Supabase
 * 客户端会话尚未应用到查询层时发出，RLS 使 posts 查询返回空，导致红点恒为不亮；
 * 会话就绪后重新拉取即可拿到真实列表。
 */
export function PostUnviewedSync() {
  const { data, fetch } = usePosts()
  const { user, ready } = useUser()

  // 会话就绪后重新拉取，修正冷启动空结果（镜像 NotificationBadgeSync 的 refresh 时机）
  useEffect(() => {
    if (ready || user?.id) void fetch()
  }, [ready, user?.id, fetch])

  useEffect(() => {
    const compute = () => setPostUnviewedFlag(data.some((p) => !isPostSeen(p.id)))
    compute()
    const unsub = subscribePostSeen(compute)
    return unsub
  }, [data])

  return null
}
