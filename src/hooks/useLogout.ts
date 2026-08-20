import { useCallback, useState } from 'react'
import Taro from '@tarojs/taro'
import { useAuth } from './useAuth'

// ============================================================
// 退出登录（守卫页/资料补全页共用）：登出后回登录页。
// signingOut 防重复点击（AdminBlockedPage 同款流程抽成 hook）。
// ============================================================

export function useLogout() {
  const { signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)

  const logout = useCallback(async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await signOut()
      // 会话已清，回到登录页（tab 页只能用 reLaunch 切换）
      void Taro.reLaunch({ url: '/pages/login/index' })
    } finally {
      setSigningOut(false)
    }
  }, [signingOut, signOut])

  return { signingOut, logout }
}
