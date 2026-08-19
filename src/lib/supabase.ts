import { createClient } from 'supabase-wechat-stable-v2'
import type { Database } from '@/types/database.types'

// 微信小程序全局 wx 的最小类型声明（项目未安装 @types/wechat-miniprogram）
declare const wx:
  | {
      getStorageSync(key: string): unknown
      setStorageSync(key: string, value: string): void
      removeStorageSync(key: string): void
    }
  | undefined

// 小程序端 storage 适配器：GoTrueClient 在 weapp 环境无 globalThis.localStorage，
// 默认回退到内存 storage（冷启动 session 必丢）；这里包装 wx 同步存储实现持久化。
// try/catch 兜底 wx storage 的大小/类型限制，失败时静默降级（下次登录重写即可）
const weappStorage = {
  getItem(key: string): string | null {
    try {
      const value = wx?.getStorageSync(key)
      return typeof value === 'string' ? value : null
    } catch {
      return null
    }
  },
  setItem(key: string, value: string) {
    try {
      wx?.setStorageSync(key, value)
    } catch {
      // wx storage 写入失败（如超出大小限制），忽略即可
    }
  },
  removeItem(key: string) {
    try {
      wx?.removeStorageSync(key)
    } catch {
      // 同上，忽略即可
    }
  },
}

// 启动校验：配置缺失直接抛错，避免静默连到错误环境导致排查困难
const supabaseUrl = process.env.TARO_APP_SUPABASE_URL
const supabaseAnonKey = process.env.TARO_APP_SUPABASE_ANON_KEY
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '缺少 Supabase 配置：请在 .env.development/.env.production 配置 TARO_APP_SUPABASE_URL/TARO_APP_SUPABASE_ANON_KEY'
  )
}

// H5 端无 wx 全局，storage 不传（SDK 回退使用 localStorage，保持双端可用）
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: typeof wx !== 'undefined' ? weappStorage : undefined,
    detectSessionInUrl: false,
  },
})
