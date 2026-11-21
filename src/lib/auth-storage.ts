import Taro from '@tarojs/taro'

/**
 * Supabase 会话在本地存储里的键名（v2 默认）：`sb-<project-ref>-auth-token`。
 * 这里只认后缀，不依赖具体 ref —— 同一个 App 只会连一个项目，多匹配到的键也只影响
 * 「冷启动时先显示确认中」这一个 UI 判断，不会当成真实会话使用。
 */
const AUTH_TOKEN_KEY_RE = /^sb-.+-auth-token$/

/**
 * 冷启动首帧同步判断「本机是否存有登录会话」。
 *
 * 用途只有一个：区分「从未登录」与「上次登录过、正在等服务端确认」——
 * `supabase.auth.getSession()` 是异步的（token 过期时还要先走一次网络刷新），
 * 这段时间里 `user` 为 null，页面若直接按 `!user` 渲染就会短暂闪出「未登录」。
 *
 * ⚠️ 这是**启发式**：有键不等于会话仍有效，真伪仍以 getSession / 服务端为准。
 * 读不到（存储不可用、平台不支持）一律按「没有」处理，宁可显示游客态也不误报。
 */
export function hasStoredAuthSession(): boolean {
  try {
    if (typeof Taro.getStorageInfoSync !== 'function') return false
    const { keys } = Taro.getStorageInfoSync()
    return keys.some((key) => AUTH_TOKEN_KEY_RE.test(key))
  } catch {
    return false
  }
}
