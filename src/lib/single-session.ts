import Taro from '@tarojs/taro'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

// 单设备会话：本地持久化「本机当前会话令牌」，与 DB profiles.session_token 比对，
// 不一致即判定本设备已被其他设备登录挤下线（详见迁移 20260822100000_add_single_session.sql）。
const TOKEN_KEY = 'pkuso_single_session_token'

type SessionRow = { session_token: string | null; session_started_at: string | null }

function toRows(data: unknown): SessionRow[] {
  if (Array.isArray(data)) return data as SessionRow[]
  if (data && typeof data === 'object') return [data as SessionRow]
  return []
}

export function getStoredSessionToken(): string | null {
  try {
    const res = Taro.getStorageSync(TOKEN_KEY)
    return typeof res === 'string' && res ? res : null
  } catch {
    return null
  }
}

export function storeSessionToken(token: string | null): void {
  try {
    if (token) Taro.setStorageSync(TOKEN_KEY, token)
    else Taro.removeStorageSync(TOKEN_KEY)
  } catch {
    // 存储不可用时静默降级（仅本机单会话检测失效，不影响登录主流程）
  }
}

export function clearSessionToken(): void {
  storeSessionToken(null)
}

export type EstablishResult = { token: string; startedAt: string } | null

/**
 * 登录 / 会话恢复时调用：覆写本人会话令牌为新的随机值（touch_session RPC），
 * 使本设备成为当前活跃会话；返回并本地存储该令牌。写路径只经 SECURITY DEFINER RPC，
 * authenticated 无 profiles.session_token 的 UPDATE/SELECT 权限。
 */
export async function establishSession(client: SupabaseClient<Database>): Promise<EstablishResult> {
  const { data, error } = await client.rpc('touch_session')
  if (error) return null
  const row = toRows(data)[0]
  const token = row?.session_token ?? null
  const startedAt = row?.session_started_at ?? null
  if (typeof token === 'string') {
    storeSessionToken(token)
    return { token, startedAt: startedAt ?? '' }
  }
  return null
}

export type VerifyResult = { kicked: boolean; startedAt: string | null }

/**
 * 比对本地令牌与 DB 当前令牌：不一致即被其他设备挤下线（kicked=true，附另一设备登录时刻）。
 * 查询失败 / 本地无令牌（极少：恢复后未成功 establish）时保守判为「未被踢」，避免误伤。
 */
export async function verifySession(client: SupabaseClient<Database>): Promise<VerifyResult> {
  const localToken = getStoredSessionToken()
  if (!localToken) return { kicked: false, startedAt: null }

  const { data, error } = await client.rpc('get_my_session')
  if (error) return { kicked: false, startedAt: null }
  const row = toRows(data)[0]
  const dbToken = row?.session_token ?? null
  const startedAt = row?.session_started_at ?? null

  if (dbToken && dbToken !== localToken) {
    return { kicked: true, startedAt }
  }
  return { kicked: false, startedAt: null }
}
