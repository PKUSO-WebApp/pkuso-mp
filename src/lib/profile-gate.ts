// ============================================================
// 登录后入口路由判定（纯函数，微信/邮箱登录共用）：
//
//   资料不完整（姓名/邮箱缺失，或邮箱仍为微信合成邮箱）→ 资料补全页
//   status = pending  → 等待审核守卫页
//   status = rejected → 审核未通过页
//   status = approved → 首页
//
// 优先级自上而下：资料补全优先于审核状态（未补全资料的用户必须先补全）。
// status 为 null（理论上 handle_new_user 触发器总写入 pending）按 pending 处理。
// ============================================================

import type { ProfileStatus } from '@/types/database'

/** 入口判定所需的最小 profile 字段集（调用方从 profiles 表按需 select） */
export type EntryProfile = {
  full_name: string | null
  email: string | null
  status: ProfileStatus | null
}

export type EntryRoutePath =
  '/pages/setup/index' | '/pages/pending/index' | '/pages/rejected/index' | '/pages/index/index'

/** 微信注册用户的合成邮箱域名：仍是合成邮箱视为「未填写邮箱」 */
const SYNTHETIC_EMAIL_SUFFIX = '@placeholder.local'

export function isSyntheticEmail(email: string | null | undefined): boolean {
  return !!email && email.endsWith(SYNTHETIC_EMAIL_SUFFIX)
}

/** 资料是否需要补全：姓名/邮箱缺失，或邮箱仍为微信合成邮箱 */
export function needsProfileSetup(profile: EntryProfile | null | undefined): boolean {
  if (!profile) return false
  return !profile.full_name?.trim() || !profile.email?.trim() || isSyntheticEmail(profile.email)
}

/** 按 profile 状态返回登录后应进入的页面；profile 为 null（未取到/查询失败）返回 null，由调用方决定落点 */
export function resolveEntryRoute(profile: EntryProfile | null | undefined): EntryRoutePath | null {
  if (!profile) return null
  if (needsProfileSetup(profile)) return '/pages/setup/index'
  if (profile.status === 'pending' || profile.status === null) return '/pages/pending/index'
  if (profile.status === 'rejected') return '/pages/rejected/index'
  return '/pages/index/index'
}
