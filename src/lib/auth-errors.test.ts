import { describe, expect, it } from 'vitest'
import { isRetryableAuthError } from './auth-errors'

const authError = (name: string, status?: number, code?: string): Error =>
  Object.assign(new Error(name), { name, status, code })

describe('isRetryableAuthError', () => {
  it('网络 / 5xx / 限流 / 未知错误：可重试', () => {
    expect(isRetryableAuthError(authError('AuthRetryableFetchError', 0))).toBe(true)
    expect(isRetryableAuthError(authError('AuthRetryableFetchError', 503))).toBe(true)
    expect(isRetryableAuthError(authError('AuthApiError', 408))).toBe(true)
    expect(isRetryableAuthError(authError('AuthApiError', 429))).toBe(true)
    expect(isRetryableAuthError(new Error('request:fail timeout'))).toBe(true)
    expect(isRetryableAuthError(null)).toBe(true)
    expect(isRetryableAuthError('boom')).toBe(true)
  })

  it('refresh token 失效 / session 不存在 / 并发丢弃：不可重试', () => {
    expect(isRetryableAuthError(authError('AuthApiError', 400, 'refresh_token_not_found'))).toBe(
      false
    )
    expect(isRetryableAuthError(authError('AuthApiError', 401))).toBe(false)
    expect(isRetryableAuthError(authError('AuthSessionMissingError', 400))).toBe(false)
    expect(isRetryableAuthError(authError('AuthRefreshDiscardedError', 409))).toBe(false)
    expect(isRetryableAuthError(authError('AuthInvalidTokenResponseError'))).toBe(false)
  })
})
