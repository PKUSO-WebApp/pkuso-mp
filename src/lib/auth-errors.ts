/**
 * auth-js 错误的「能不能靠重试解决」判据。
 *
 * `getSession()` / `refreshSession()` 失败时，错误分两类：
 * - **可重试**：网络不可达、网关 5xx、429/408 限流——等一会儿再试有意义；
 *   auth-js 把网络与 5xx 包成 `AuthRetryableFetchError`。
 * - **定论**：refresh token 已失效（`refresh_token_not_found`）、session 已不存在、
 *   并发 signOut 丢弃了刷新结果——GoTrue 已经给出结论，再试一百次也是同一个结果。
 *   这类必须清本地会话、走登录守卫，而不是让用户停在「加载失败 + 重试」。
 *
 * 未知错误按可重试处理：宁可让用户点一次重试，也不要把一次网络抖动误判成登出。
 */
export function isRetryableAuthError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return true
  const name = (err as { name?: unknown }).name
  if (typeof name !== 'string') return true

  // 网络 / 5xx：auth-js 明确标为可重试
  if (name === 'AuthRetryableFetchError') return true
  // 非标准错误的包装（可能含网络/解析问题）：保守重试
  if (name === 'AuthUnknownError') return true

  // 限流/超时：虽然是 4xx，但等一会儿可能恢复
  const status = (err as { status?: unknown }).status
  if (name === 'AuthApiError' && (status === 408 || status === 429)) return true

  // 其余带 Auth 前缀的是 GoTrue 的定论错误
  // （AuthApiError 4xx / AuthSessionMissingError / AuthRefreshDiscardedError /
  //   AuthInvalidTokenResponseError / AuthInvalidJwtError …）
  return !name.startsWith('Auth')
}
