import { useUser } from '@/context/user-context'
import { useProfiles } from '@/hooks/useProfiles'
import type { ProfileRow } from '@/types/database'

export type MyProfileResult = {
  /** 当前登录用户的 profile（未加载完成或查询失败时为 null） */
  profile: ProfileRow | null
  /** profile 查询是否进行中 */
  loading: boolean
}

/**
 * 当前登录用户的 profile（经 profiles_roster 视图按 userId 查询，本人永远看到未掩码原值）。
 * user 未就绪时传显式 undefined，useProfiles 跳过请求返回空列表（不退化全表查询）。
 * 供页面获取姓名/角色（管理端阻断判断）等自身信息，避免各页面重复拼 useProfiles 调用。
 */
export function useMyProfile(): MyProfileResult {
  const { user } = useUser()
  const { data, loading } = useProfiles(user ? { userId: user.id } : undefined)
  return { profile: data[0] ?? null, loading }
}
