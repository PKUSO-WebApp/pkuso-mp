import Taro from '@tarojs/taro'
import { logDiag } from '@/lib/session-diag'

/**
 * 分享页未登录守卫的公共返回路径构造。
 *
 * 只保留非空参数并剔除 `returnTo` 自身，避免二次登录时把上一次的 returnTo 叠进 query。
 * 值按原样拼接：调用方随后对整个 returnTo 做一次 encodeURIComponent，登录页再解码。
 */
export function buildReturnTo(
  currentPath: string,
  params: Record<string, unknown> | undefined | null
): string {
  const query = Object.entries(params ?? {})
    .filter(
      ([key, value]) => key !== 'returnTo' && value !== undefined && value !== null && value !== ''
    )
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&')
  return query ? `${currentPath}?${query}` : currentPath
}

/** 跳登录页并带上 returnTo；跳转失败必须留痕，否则页面会永远停在加载态。 */
export function redirectToLogin(returnTo: string): void {
  void Taro.redirectTo({
    url: `/pages/login/index?returnTo=${encodeURIComponent(returnTo)}`,
  }).catch((err: unknown) => {
    logDiag('login_redirect_failed', { err: String(err) })
  })
}
