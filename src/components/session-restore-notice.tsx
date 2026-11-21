import { useRef, useState } from 'react'
import { Text, View } from '@tarojs/components'
import { Spinner } from '@/components/ui/Spinner'
import { useT } from '@/i18n'
import { useUser } from '@/context/user-context'

type Props = {
  state: 'restoring' | 'restore-failed'
}

/**
 * 冷启动「正在确认登录状态」占位。
 *
 * 只在**本机存有会话**时出现（判据见 `lib/auth-store` 与 `hooks/useSessionViewState`）：
 * 从未登录的用户直接看游客态，不需要等；回访用户则明确告诉他「在确认」，
 * 而不是闪一下「未登录」。确认超时/断网时给重试入口，避免弱网用户被迫重登。
 */
export function SessionRestoreNotice({ state }: Props) {
  const { t } = useT()
  const { retryRestore } = useUser()
  const [retrying, setRetrying] = useState(false)
  const retryingRef = useRef(false)

  const failed = state === 'restore-failed'
  const showRetry = failed && !retrying
  const text = showRetry ? t('common.sessionRestore.failed') : t('common.sessionRestore.confirming')

  return (
    <View className='flex flex-1 flex-col items-center justify-center gap-3 px-4'>
      {(!failed || retrying) && <Spinner size='sm' />}
      <Text className='text-center text-sm text-text-muted'>{text}</Text>
      {showRetry && (
        <View
          className='rounded-full border border-border bg-card px-4 py-1.5'
          onClick={() => {
            // 同步 ref 挡连点：setState 要等下一次渲染，第二次点击会读到旧值
            if (retryingRef.current) return
            retryingRef.current = true
            setRetrying(true)
            void retryRestore().finally(() => {
              retryingRef.current = false
              setRetrying(false)
            })
          }}
        >
          <Text className='text-xs font-medium text-text'>{t('common.actions.retry')}</Text>
        </View>
      )}
    </View>
  )
}
