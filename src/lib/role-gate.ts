import type { ProfileRole } from '@/types/database'

/**
 * 小程序只服务**乐团成员**：`admin` 与 `score_manager` 都是专职账号，不算团员 ——
 * 各页以阻断页替代内容、花名册里也不出现他们。
 *
 * ⚠️ 判据写「**是** member」而不是「不是 admin」：黑名单式每加一个角色都要改 6 处页面，
 * 漏改一处新角色就静默拿到成员功能；反过来写则未知角色一律失败关闭。
 * （pkuso-web 的成员名单是同一取向：`(r.role ?? "member") === "member"`。）
 *
 * `role` 列可空（无 NOT NULL）。空值按**列默认值** `member` 算 —— 别写成 `?? ''`：
 * 那会让 role 为空的老账号既进不去页面、又从花名册里静默消失。
 */
export function isOrchestraMember(role: ProfileRole | null | undefined): boolean {
  return (role ?? 'member') === 'member'
}
