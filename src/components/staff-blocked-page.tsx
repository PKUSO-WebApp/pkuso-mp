import { useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useAuth } from '@/hooks/useAuth'
import { useThemeClass } from '@/context/theme-context'
import { useT } from '@/i18n'
import type { ProfileRole } from '@/types/database'

type StaffBlockedPageProps = {
  /** 当前账号的角色：admin 与非 member 的专职账号看到的理由不同 */
  role: ProfileRole | null | undefined
}

/**
 * 非团员账号登录小程序时的阻断页（member 端各页共用）。
 * 小程序只服务乐团成员：admin 全部留在 Web（规划 §1），谱务等专职账号也不提供成员功能。
 * 各页以本组件替代页面内容，并给出退出登录入口。
 *
 * ⚠️ **两套文案按角色分**：给 admin 的那句「不提供小程序管理端」对谱务账号是**错的**
 * —— 他不是管理员，理由应当是「专职账号不提供成员功能」。pkuso-web 的登录页为同一件事
 * 也专门避开了误导性措辞（那边写过注释说明为什么不能复用这句话）。
 */
export function StaffBlockedPage({ role }: StaffBlockedPageProps) {
  const { signOut } = useAuth()
  const { t } = useT()
  const [signingOut, setSigningOut] = useState(false)

  const isAdmin = role === 'admin'
  const title = isAdmin ? t('ui.adminBlocked.title') : t('ui.staffBlocked.title')
  const desc = isAdmin ? t('ui.adminBlocked.desc') : t('ui.staffBlocked.desc')
  const logout = isAdmin ? t('ui.adminBlocked.logout') : t('ui.staffBlocked.logout')
  const loggingOut = isAdmin ? t('ui.adminBlocked.loggingOut') : t('ui.staffBlocked.loggingOut')

  const handleLogout = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await signOut()
      // 会话已清，回到登录页（tab 页只能用 reLaunch 切换）
      void Taro.reLaunch({ url: '/pages/login/index' })
    } finally {
      setSigningOut(false)
    }
  }

  const darkClass = useThemeClass()

  return (
    <View
      className={`${darkClass} flex h-full flex-col items-center justify-center gap-4 bg-page-bg px-6 pb-safe`}
    >
      <Text className='text-lg font-semibold text-text'>{title}</Text>
      <Text className='text-center text-sm text-text-muted'>{desc}</Text>
      <View
        className={`mt-2 rounded-full bg-primary px-6 py-2 text-sm font-medium text-primary-foreground ${
          signingOut ? 'opacity-60' : ''
        }`}
        onClick={() => void handleLogout()}
      >
        {signingOut ? loggingOut : logout}
      </View>
    </View>
  )
}
