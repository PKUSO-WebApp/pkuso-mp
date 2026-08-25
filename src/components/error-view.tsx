import Taro from '@tarojs/taro'
import { View, Text, Button } from '@tarojs/components'
import { useThemeClass } from '@/context/theme-context'
import { useT } from '@/i18n'

interface ErrorViewProps {
  title?: string
  message: string
  stack?: string
}

export function ErrorView({ title, message, stack }: ErrorViewProps) {
  const { t } = useT()
  const darkClass = useThemeClass()
  const resolvedTitle = title ?? t('common.error.defaultTitle')
  const full = stack ? `${message}\n\n${stack}` : message

  const handleCopy = () => {
    Taro.setClipboardData({ data: full })
      .then(() => Taro.showToast({ title: t('common.error.copySuccess'), icon: 'none' }))
      .catch(() => Taro.showToast({ title: t('common.error.copyFailed'), icon: 'none' }))
  }

  return (
    <View className={`${darkClass} min-h-screen bg-page-bg px-10 py-24`}>
      <Text className='mb-3 block text-center text-[40px] leading-none'>⚠️</Text>
      <Text className='mb-3 block text-center text-lg font-semibold text-text'>
        {resolvedTitle}
      </Text>
      <Text className='mb-3 block break-all text-sm leading-relaxed text-text-muted'>
        {message}
      </Text>
      {stack ? (
        <Text className='mb-4 block whitespace-pre-wrap break-all rounded-lg bg-muted p-2 text-xs leading-normal text-text-muted'>
          {stack}
        </Text>
      ) : null}
      <Button onClick={handleCopy}>{t('common.error.copyButton')}</Button>
      <Text className='mt-3 block text-center text-xs leading-relaxed text-text-subtle'>
        {t('common.error.hint')}
      </Text>
    </View>
  )
}
