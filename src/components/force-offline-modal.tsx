import { View, Text, Button } from '@tarojs/components'
import { formatDateTimeInChina } from '@/lib/date-utils'

export type ForceOfflineModalProps = {
  opened: boolean
  /** 另一设备登录时刻（ISO 字符串），为 null 时显示「刚刚」 */
  at: string | null
  onClose: () => void
}

/**
 * 强制下线通知：本设备会话被其他设备登录挤下线时弹出。
 * 覆盖层级高于普通 Modal（z-[70] vs z-[60]），登录页处于其下。
 */
export function ForceOfflineModal({ opened, at, onClose }: ForceOfflineModalProps) {
  if (!opened) return null
  const when = at ? formatDateTimeInChina(at) : '刚刚'
  return (
    <View
      className='fixed left-0 right-0 top-0 bottom-0 z-[70] flex items-center justify-center bg-overlay px-6'
      catchMove
    >
      <View className='w-full max-w-sm rounded-2xl border border-border bg-surface p-5'>
        <Text className='block text-base font-semibold text-text'>账号已在其他设备登录</Text>
        <Text className='mt-3 block text-sm leading-relaxed text-text-muted'>
          {`另一设备于 ${when} 登录你的账号，当前设备已经下线。`}
        </Text>
        <Text className='mt-2 block text-sm leading-relaxed text-text-muted'>
          如果这不是你本人的操作，说明你的密码可能已经泄露，请尽快重新登录并修改密码。
        </Text>
        <Button
          hoverClass='none'
          className='mt-4 w-full rounded-xl border-none bg-primary px-3 py-2 text-sm font-medium text-primary-foreground'
          onClick={onClose}
        >
          重新登录
        </Button>
      </View>
    </View>
  )
}
