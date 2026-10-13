import { useEffect } from 'react'
import { View, Text, Button } from '@tarojs/components'
import { useT } from '@/i18n'
import { logDiag } from '@/lib/session-diag'
import type { SessionKickKind } from '@/lib/device-session'

export type ForceOfflineModalProps = {
  opened: boolean
  onClose: () => void
  /**
   * 下线原因（决定文案）：'rejected' = 被设为不信任（默认），'deleted' = 被「删除设备」。
   * 缺省 / 未知取值一律走 'rejected' —— 老调用方不传时行为与从前一致。
   */
  kind?: SessionKickKind | null
}

/**
 * 强制下线通知：本设备被设为「不信任」或被删除时弹出 —— 在线被踢下线，或登录/冷启动被服务端拒绝。
 * 覆盖层级高于普通 Modal（z-[70] vs z-[60]），登录页处于其下。
 */
export function ForceOfflineModal({ opened, onClose, kind = 'rejected' }: ForceOfflineModalProps) {
  const { t } = useT()
  const deleted = kind === 'deleted'

  useEffect(() => {
    if (opened) logDiag('force_offline_modal_render', { opened: true, kind: kind ?? 'rejected' })
  }, [opened, kind])

  if (!opened) return null
  return (
    <View
      className='fixed left-0 right-0 top-0 bottom-0 z-[70] flex items-center justify-center bg-overlay px-6'
      catchMove
    >
      <View className='w-full max-w-sm rounded-2xl border border-border bg-surface p-5'>
        <Text className='block text-base font-semibold text-text'>
          {deleted ? t('ui.forceOffline.deleted.title') : t('ui.forceOffline.rejected.title')}
        </Text>
        <Text className='mt-3 block text-sm leading-relaxed text-text-muted'>
          {deleted ? t('ui.forceOffline.deleted.line1') : t('ui.forceOffline.rejected.line1')}
        </Text>
        <Text className='mt-2 block text-sm leading-relaxed text-text-muted'>
          {deleted ? t('ui.forceOffline.deleted.line2') : t('ui.forceOffline.rejected.line2')}
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
