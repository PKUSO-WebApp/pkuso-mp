import Taro from '@tarojs/taro'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { getDeviceName, getDevicePlatform, getOrCreateDeviceId } from './device-id'

// 设备会话：每台设备在 user_devices 里占一行，本机凭 device_id 认领自己那一行。
// 读写只经 SECURITY DEFINER RPC（表只给本人 SELECT —— 客户端能直改 trusted 的话那道门就是摆设）。
//
// ⚠️ 与老的单设备模型彻底无关（那套是 profiles.session_token 覆写 + 本地令牌比对）：
// 老的两个 RPC 一个字节没动，仍在给老版本客户端用；本模块不读也不写那一列。
const LEGACY_TOKEN_KEY = 'pkuso_single_session_token'

function toRows<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object') return [data as T]
  return []
}

// 主动登出标志：useAuth 调用 supabase.auth.signOut 前置位，供 onAuthStateChange
// 区分「本人主动登出」与「被踢下线」，避免误弹强制下线通知。
let intentionalSignOut = false
export function markIntentionalSignOut(): void {
  intentionalSignOut = true
}
export function consumeIntentionalSignOut(): boolean {
  const v = intentionalSignOut
  intentionalSignOut = false
  return v
}

/**
 * 清掉旧单设备模型的本地令牌残留。
 * 新模型不再写这个键（判据是服务端的 trusted），只在主动登出 / 被踢时顺手清理。
 */
export function clearLegacySessionToken(): void {
  try {
    Taro.removeStorageSync(LEGACY_TOKEN_KEY)
  } catch {
    // 存储不可用时无事可做
  }
}

export type TouchSessionResult = {
  /** RPC 成功：本设备这一行已登记 / 刷新 */
  ok: boolean
  /** 服务端明确拒绝：本设备被设为不信任（message 含 device_rejected），且此后拒绝再登录 */
  rejected: boolean
}

/**
 * 登录 / 冷启动：登记或刷新**本设备**这一行（touch_session_v2）。
 *
 * 两类失败要分开：
 * - `device_rejected`：明确的拒绝 ⇒ rejected=true，由调用方撤销会话并提示；
 * - 其余错误（网络抖动 / 瞬时鉴权失败）：**不阻断登录** —— 沿用旧实现那种保守立场，
 *   一次 RPC 失败不该把人挡在门外（下一次冷启动或轮询会补上）。
 */
export async function touchSession(client: SupabaseClient<Database>): Promise<TouchSessionResult> {
  try {
    const { error } = await client.rpc('touch_session_v2', {
      p_device_id: getOrCreateDeviceId(),
      p_name: getDeviceName(),
      p_platform: getDevicePlatform(),
    })
    if (error) {
      return { ok: false, rejected: /device_rejected/.test(error.message ?? '') }
    }
    return { ok: true, rejected: false }
  } catch {
    return { ok: false, rejected: false }
  }
}

/**
 * 被踢下线的两种原因 —— 同一个「trusted = false」，用户看到的事不一样：
 * - `'rejected'`：被设为不信任（行留着、列表里看得见、可恢复信任，之后一直拒绝它登录）；
 * - `'deleted'` ：被「删除设备」（墓碑行，列表里看不见；它下次登录会被当作新设备）。
 * 只影响提示文案，不影响踢不踢（判据始终是 trusted）。
 */
export type SessionKickKind = 'rejected' | 'deleted'

export type VerifyResult = {
  kicked: boolean
  /** 被踢的原因；没被踢时为 null */
  kind: SessionKickKind | null
}

/**
 * 自查（15 秒轮询 + 回前台）：**被踢的判据只有一个** —— 本设备这一行存在且 trusted === false
 * （被设为不信任 / 被删除 ⇒ 踢下线）。
 *
 * 保守方向很重要：查不到行（新装机 / 换了 device_id）或查询失败一律判「没被踢」，
 * 否则瞬时 401 / 网络抖动会把人误判成被踢而误杀会话（表现为 profile 全「-」、无通知、设置失效）。
 */
export async function verifySession(client: SupabaseClient<Database>): Promise<VerifyResult> {
  const { data, error } = await client.rpc('get_my_session_v2', {
    p_device_id: getOrCreateDeviceId(),
  })
  if (error) return { kicked: false, kind: null }
  const row = toRows<{ trusted: boolean; deleted_at: string | null }>(data)[0]
  if (!row) return { kicked: false, kind: null }
  if (row.trusted !== false) return { kicked: false, kind: null }
  // kind 只读 `deleted_at`：墓碑行必然 trusted = false（服务端有 CHECK 约束），
  // 所以「trusted = false 且没有墓碑」就是被设为不信任。
  return { kicked: true, kind: row.deleted_at ? 'deleted' : 'rejected' }
}

export type DeviceInfo = {
  deviceId: string
  name: string
  platform: string
  trusted: boolean
  createdAt: string
  lastSeenAt: string
}

type DeviceRow = {
  device_id: string
  name: string
  platform: string | null
  trusted: boolean
  created_at: string
  last_seen_at: string
}

/**
 * 设置页列表：**含被设为不信任的那几台**（要能恢复就不能把它们藏起来）。
 * 顺序由服务端给（已信任优先、同组按最后活跃倒序），客户端不再排。
 */
export async function listMyDevices(
  client: SupabaseClient<Database>
): Promise<{ ok: boolean; devices: DeviceInfo[] }> {
  try {
    const { data, error } = await client.rpc('list_my_devices')
    if (error) return { ok: false, devices: [] }
    const devices = toRows<DeviceRow>(data).map((row) => ({
      deviceId: row.device_id,
      name: row.name,
      platform: row.platform ?? '',
      trusted: row.trusted,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    }))
    return { ok: true, devices }
  } catch {
    return { ok: false, devices: [] }
  }
}

/**
 * 把**本机**挪到列表最前，其余保持服务端给的相对顺序（用户 2026-10-16 定）。
 *
 * 为什么在客户端做：`list_my_devices` 的排序讲的是「已信任优先」，本机排第几要看它在服务端
 * 的创建时间与信任态。可用户打开这一页最先要找的就是「这台」—— 它既是「我正在用哪台」的答案，
 * 也是别的那几台上「我该拿哪一行去比对」的参照。排在最上面就不用每次滚动着找。
 *
 * ⚠️ 只改**显示顺序**：拉取结果仍是唯一真相（页面用 useMemo 从它派生，不写回 state），
 * 所以接口返回的顺序、以及「操作后重新拉一遍」那条纪律都不受影响。
 *
 * 纯函数：本机已在最前（或压根不在列表里）时**返回同一个引用** —— 别为一次无变化的排序
 * 制造新数组，那会让下游的 memo 白跑一遍。
 */
export function selfFirst<T extends { deviceId: string }>(
  devices: T[],
  selfDeviceId: string
): T[] {
  const self = devices.find((d) => d.deviceId === selfDeviceId)
  if (!self || devices[0] === self) return devices
  return [self, ...devices.filter((d) => d !== self)]
}

export type SetTrustResult = { ok: boolean; reason?: 'cannot_untrust_self' | 'caller_not_trusted' }

/**
 * 设为不信任（踢下线 + 此后拒绝该设备登录）/ 恢复信任。
 *
 * **永远不能拒绝自己**：目标就是本机时直接返回、不发请求。服务端也会以
 * `cannot_untrust_self` 硬拦（客户端能藏按钮，藏不住一条直接调用的请求），
 * 这里挡一道是为了让界面没有任何「把自己拒之门外」的入口。
 *
 * `caller_not_trusted` = 服务端认出发起方自己已被设为不信任 / 已删除（规则 C）⇒
 * 界面**直接踢出**本机（见 devices 页的 `ensureSelfTrusted`），不是弹个「操作失败」了事。
 */
export async function setDeviceTrust(
  client: SupabaseClient<Database>,
  selfDeviceId: string,
  deviceId: string,
  trusted: boolean
): Promise<SetTrustResult> {
  if (deviceId === selfDeviceId) return { ok: false, reason: 'cannot_untrust_self' }
  try {
    const { error } = await client.rpc('set_device_trust', {
      p_self_device_id: selfDeviceId,
      p_device_id: deviceId,
      p_trusted: trusted,
    })
    if (error) {
      return {
        ok: false,
        reason: /caller_not_trusted/.test(error.message ?? '') ? 'caller_not_trusted' : undefined,
      }
    }
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export type DeleteDeviceResult = { ok: boolean; reason?: 'cannot_delete_self' | 'caller_not_trusted' }

/**
 * 删除设备：这台设备立刻下线、从设备列表里消失，**下一次它登录时被当作新设备**
 * （照发一条「新设备登录」通知给本人）—— 与「设为不信任」的区别就在这里：
 * 后者是「以后一直拒绝」，前者是「我不认识这台，让它忘了我，但它再进来要告诉我」。
 *
 * **永远不能删除自己**：目标就是本机时直接返回、不发请求。与 setDeviceTrust 里那条
 * 「不能拒绝自己」是同一道第二防线（理由也相同：本机当场被踢，而恢复的入口需要先登录），
 * 服务端另有 `cannot_block_self` 硬拦。
 */
export async function deleteDevice(
  client: SupabaseClient<Database>,
  selfDeviceId: string,
  deviceId: string
): Promise<DeleteDeviceResult> {
  if (deviceId === selfDeviceId) return { ok: false, reason: 'cannot_delete_self' }
  try {
    const { error } = await client.rpc('delete_device', {
      p_self_device_id: selfDeviceId,
      p_device_id: deviceId,
    })
    if (error) {
      return {
        ok: false,
        reason: /caller_not_trusted/.test(error.message ?? '') ? 'caller_not_trusted' : undefined,
      }
    }
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
