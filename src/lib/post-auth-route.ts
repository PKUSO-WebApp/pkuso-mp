import { supabase as defaultClient } from '@/lib/supabase'
import { safeNavigate } from './navigate'
import { resolveEntryRoute, type EntryProfile } from './profile-gate'

// ============================================================
// 登录成功后的统一入口路由：
//   微信登录 / 邮箱登录 / 冷启动会话恢复三处共用——读本人 profile 后按
//   resolveEntryRoute 决定落点（资料补全 / 等待审核 / 审核未通过 / 首页）。
//
// profile 经 SECURITY DEFINER RPC get_my_profile_entry 读取：profiles 表
// 对 authenticated 已撤销表级 SELECT（20260818165318，email 等敏感列不在
// 列级白名单），直查报 permission denied——所有成员入口路由都会失败、
// 卡在守卫页（用户实测）。RPC 仅返回 auth.uid() 本人行，不扩大权限面。
//
// 查询失败（网络/RPC 异常）降级到「等待审核」守卫页：宁可让已通过成员
// 多一次「刷新状态」，也不放未审核用户直接进首页（审核门形同虚设）。
// ============================================================

export async function routeAfterLogin(client: typeof defaultClient = defaultClient): Promise<void> {
  let profile: EntryProfile | null = null
  try {
    const { data, error } = await client.rpc('get_my_profile_entry')
    if (!error) {
      profile = (data as EntryProfile[] | null)?.[0] ?? null
    }
  } catch {
    // 查询失败：profile 保持 null，走下方安全落点
  }
  const target = resolveEntryRoute(profile) ?? '/pages/pending/index'
  // 用带兜底的跳转，而不是裸的 Taro.reLaunch：后者失败会抛给调用方，被登录链路当成
  // **登录失败**上报（会话其实已经建立好了）——用户看到「微信登录失败」，而事实只是
  // 没跳过去。失败时 safeNavigate 上报 + 轻提示，用户留在原页面重按一次即可。
  await safeNavigate('reLaunch', target)
}
