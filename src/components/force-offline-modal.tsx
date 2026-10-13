import { useEffect } from 'react'
import { View, Text, Button } from '@tarojs/components'
import { useT } from '@/i18n'
import { logDiag } from '@/lib/session-diag'

export type ForceOfflineModalProps = {
  opened: boolean
  onClose: () => void
}

/**
 * 强制下线通知：本设备被设为「不信任」时弹出 —— 在线被踢下线，或登录/冷启动被服务端拒绝。
 * 覆盖层级高于普通 Modal（z-[70] vs z-[60]），登录页处于其下。
 */
export function ForceOfflineModal({ opened, onClose }: ForceOfflineModalProps) {
  const { t } = useT()

  useEffect(() => {
    if (opened) logDiag('force_offline_modal_render', { opened: true })
  }, [opened])

  if (!opened) return null
  return (
    <View
      className='fixed left-0 right-0 top-0 bottom-0 z-[70] flex items-center justify-center bg-overlay px-6'
      catchMove
    >
      <View className='w-full max-w-sm rounded-2xl border border-border bg-surface p-5'>
        <Text className='block text-base font-semibold text-text'>
          {t('ui.forceOffline.title')}
        </Text>
        <Text className='mt-3 block text-sm leading-relaxed text-text-muted'>
          {t('ui.forceOffline.line1')}
        </Text>
        <Text className='mt-2 block text-sm leading-relaxed text-text-muted'>
          {t('ui.forceOffline.line2')}
        </Text>
        <Button
          hoverClass='none'
          className='mt-4 w-full rounded-xl border-none bg-primary px-3 py-2 text-sm font-medium text-primary-foreground'
          onClick={onClose}
        >
          {t('ui.forceOffline.confirm')}
        </Button>
      </View>
    </View>
  )
}
