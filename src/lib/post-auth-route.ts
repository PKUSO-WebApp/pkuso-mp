import Taro from '@tarojs/taro'
import { supabase as defaultClient } from '@/lib/supabase'
import { resolveEntryRoute, type EntryProfile } from './profile-gate'

// ============================================================
// 登录成功后的统一入口路由：
//   微信登录 / 邮箱登录 / 冷启动会话恢复三处共用——查 profile 后按
//   resolveEntryRoute 决定落点（资料补全 / 等待审核 / 审核未通过 / 首页）。
//
// 查询失败（网络/RLS 异常）降级到「等待审核」守卫页：宁可让已通过成员
// 多一次「刷新状态」，也不放未审核用户直接进首页（审核门形同虚设）。
// ============================================================

export async function routeAfterLogin(
  client: typeof defaultClient = defaultClient,
  userId: string
): Promise<void> {
  let profile: EntryProfile | null = null
  try {
    const { data } = await client
      .from('profiles')
      .select('full_name, email, status')
      .eq('id', userId)
      .maybeSingle()
    profile = (data as EntryProfile | null) ?? null
  } catch {
    // 查询失败：profile 保持 null，走下方安全落点
  }
  const target = resolveEntryRoute(profile) ?? '/pages/pending/index'
  await Taro.reLaunch({ url: target })
}
