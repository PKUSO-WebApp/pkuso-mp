import { useUser } from '@/context/user-context'
import { resolveSessionViewState, type SessionViewState } from '@/lib/session-restore'

/**
 * 页面用的会话状态（见 `lib/session-restore.ts`）。
 *
 * 页面不要再直接写 `const isGuest = !user`：冷启动时 `user` 尚未恢复，
 * 会把「正在确认登录状态」误显示成「未登录」。
 */
export function useSessionViewState(): SessionViewState {
  const { ready, user, restoreFailed, hasStoredSession } = useUser()
  return resolveSessionViewState({
    ready,
    hasUser: !!user,
    restoreFailed,
    hasStoredSession,
  })
}
