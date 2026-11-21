/**
 * 冷启动会话的页面视角（纯函数，便于单测）。
 *
 * - `authenticated`：会话已恢复
 * - `restoring`：本机存有会话，正在等 SDK/服务端确认
 * - `restore-failed`：确认超时或网络失败（本地会话可能仍有效，给用户重试入口）
 * - `guest`：确定没有会话（从未登录，或本地会话已失效）
 */
export type SessionViewState = 'authenticated' | 'restoring' | 'restore-failed' | 'guest'

type Input = {
  ready: boolean
  hasUser: boolean
  restoreFailed: boolean
  /** 冷启动时同步读到的「本机存有会话」标记 */
  hasStoredSession: boolean
}

export function resolveSessionViewState({
  ready,
  hasUser,
  restoreFailed,
  hasStoredSession,
}: Input): SessionViewState {
  if (hasUser) return 'authenticated'
  if (!ready) return hasStoredSession ? 'restoring' : 'guest'
  // 没有本地会话时恢复失败没有「重试」的意义——从未登录的人直接看游客态
  if (restoreFailed) return hasStoredSession ? 'restore-failed' : 'guest'
  return 'guest'
}
