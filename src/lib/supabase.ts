import { createClient as createWebClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClient as createWeappClient } from 'supabase-wechat-stable-v2'
import type { Database } from '@/types/database.types'

// 启动校验：配置缺失直接抛错，避免静默连到错误环境导致排查困难（双端共享）
const supabaseUrl = process.env.TARO_APP_SUPABASE_URL
const supabaseAnonKey = process.env.TARO_APP_SUPABASE_ANON_KEY
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '缺少 Supabase 配置：请在 .env.development/.env.production 配置 TARO_APP_SUPABASE_URL/TARO_APP_SUPABASE_ANON_KEY'
  )
}

// 双端分叉：TARO_ENV 在构建期被 DefinePlugin 替换为字面量，条件表达式由 terser 常量折叠。
// - weapp：supabase-wechat-stable-v2（内部硬编码 wx.request 与 wx storage，仅微信端可用）
// - h5/其他：官方 @supabase/supabase-js（浏览器 fetch/localStorage）
// 两包 Database 泛型同构（GenericSchema），对外统一以官方包类型为准
export const supabase = (
  process.env.TARO_ENV === 'weapp'
    ? createWeappClient<Database>(supabaseUrl, supabaseAnonKey, {
        auth: { detectSessionInUrl: false },
      })
    : createWebClient<Database>(supabaseUrl, supabaseAnonKey, {
        auth: { detectSessionInUrl: false },
      })
) as SupabaseClient<Database>
