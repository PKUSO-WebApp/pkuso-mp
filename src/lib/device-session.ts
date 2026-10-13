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

export type VerifyResult = { kicked: boolean }

/**
 * 自查（15 秒轮询 + 回前台）：**被踢的判据只有一个** —— 本设备这一行存在且 trusted === false
 * （被设为不信任 ⇒ 踢下线）。
 *
 * 保守方向很重要：查不到行（新装机 / 换了 device_id）或查询失败一律判「没被踢」，
 * 否则瞬时 401 / 网络抖动会把人误判成被踢而误杀会话（表现为 profile 全「-」、无通知、设置失效）。
 */
export async function verifySession(client: SupabaseClient<Database>): Promise<VerifyResult> {
  const { data, error } = await client.rpc('get_my_session_v2', {
    p_device_id: getOrCreateDeviceId(),
  })
  if (error) return { kicked: false }
  const row = toRows<{ trusted: boolean }>(data)[0]
  if (!row) return { kicked: false }
  return { kicked: row.trusted === false }
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

export type SetTrustResult = { ok: boolean; reason?: 'cannot_untrust_self' }

/**
 * 设为不信任（踢下线 + 此后拒绝该设备登录）/ 恢复信任。
 *
 * **永远不能拒绝自己**：目标就是本机时直接返回、不发请求。服务端也会以
 * `cannot_untrust_self` 硬拦（客户端能藏按钮，藏不住一条直接调用的请求），
 * 这里挡一道是为了让界面没有任何「把自己拒之门外」的入口。
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
    if (error) return { ok: false }
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
