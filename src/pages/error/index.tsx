import { useRouter } from '@tarojs/taro'
import { View } from '@tarojs/components'
import { ErrorView } from '@/components/error-view'
import { useT } from '@/i18n'
import './index.scss'

export default function ErrorPage() {
  const router = useRouter()
  const { t } = useT()
  const params = router.params
  const message = params.msg ? decodeURIComponent(params.msg) : t('common.error.defaultTitle')
  const stack = params.stack ? decodeURIComponent(params.stack) : undefined

  return (
    <View>
      <ErrorView message={message} stack={stack} />
    </View>
  )
}
