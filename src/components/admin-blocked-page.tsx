import { useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useAuth } from '@/hooks/useAuth'

/**
 * 管理端账号登录小程序时的阻断页（member 端各页共用）。
 * 小程序不提供管理端功能（规划 §1：admin 全部留在 Web），管理员登录后
 * 各页以本组件替代页面内容，提示改用网页端，并提供退出登录入口。
 */
export function AdminBlockedPage() {
  const { signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)

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

  return (
    <View className='flex h-full flex-col items-center justify-center gap-4 bg-page-bg px-6 pb-safe'>
      <Text className='text-lg font-semibold text-text'>不提供小程序管理端，请使用网页端</Text>
      <Text className='text-center text-sm text-text-muted'>
        小程序仅面向乐团成员；审批、排练管理、考勤统计等管理功能请使用网页端。
      </Text>
      <View
        className={`mt-2 rounded-full bg-primary px-6 py-2 text-sm font-medium text-primary-foreground ${
          signingOut ? 'opacity-60' : ''
        }`}
        onClick={() => void handleLogout()}
      >
        {signingOut ? '退出中…' : '退出登录'}
      </View>
    </View>
  )
}
