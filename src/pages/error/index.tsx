import { useRouter } from '@tarojs/taro'
import { View } from '@tarojs/components'
import { ErrorView } from '@/components/error-view'
import { useT } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import './index.scss'

export default function ErrorPage() {
  const router = useRouter()
  const darkClass = useThemeClass()
  const { t } = useT()
  const params = router.params
  const message = params.msg ? decodeURIComponent(params.msg) : t('common.error.defaultTitle')
  const stack = params.stack ? decodeURIComponent(params.stack) : undefined

  return (
    <View className={`${darkClass} min-h-full bg-page-bg`}>
      <ErrorView message={message} stack={stack} />
    </View>
  )
}
