import { describe, expect, it } from 'vitest'
import { resolveSessionViewState } from './session-restore'

describe('resolveSessionViewState', () => {
  const base = { ready: false, hasUser: false, restoreFailed: false, hasStoredSession: false }

  it('有 user 时一律是 authenticated（即使其它标志还没复位）', () => {
    expect(
      resolveSessionViewState({ ...base, ready: false, hasUser: true, restoreFailed: true })
    ).toBe('authenticated')
  })

  it('恢复中且本机有会话 → restoring（不显示游客态）', () => {
    expect(resolveSessionViewState({ ...base, ready: false, hasStoredSession: true })).toBe(
      'restoring'
    )
  })

  it('恢复中且本机没有会话 → guest（从未登录，不用等）', () => {
    expect(resolveSessionViewState({ ...base, ready: false, hasStoredSession: false })).toBe(
      'guest'
    )
  })

  it('恢复失败且本机有会话 → restore-failed（给重试，不当作游客）', () => {
    expect(
      resolveSessionViewState({
        ...base,
        ready: true,
        restoreFailed: true,
        hasStoredSession: true,
      })
    ).toBe('restore-failed')
  })

  it('恢复完成且没有会话 → guest', () => {
    expect(resolveSessionViewState({ ...base, ready: true, hasStoredSession: true })).toBe('guest')
  })

  it('没有本地会话时恢复失败 → guest（没有可重试的会话）', () => {
    expect(
      resolveSessionViewState({
        ...base,
        ready: true,
        restoreFailed: true,
        hasStoredSession: false,
      })
    ).toBe('guest')
  })
})
