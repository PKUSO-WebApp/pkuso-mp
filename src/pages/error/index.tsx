import { useRouter } from '@tarojs/taro'
import { View } from '@tarojs/components'
import { ErrorView } from '@/components/error-view'
import './index.scss'

export default function ErrorPage() {
  const router = useRouter()
  const params = router.params
  const message = params.msg ? decodeURIComponent(params.msg) : '发生了未知错误'
  const stack = params.stack ? decodeURIComponent(params.stack) : undefined

  return (
    <View>
      <ErrorView message={message} stack={stack} />
    </View>
  )
}
