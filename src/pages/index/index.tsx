import { View, Text } from '@tarojs/components'
import { useLoad } from '@tarojs/taro'
import './index.scss'

export default function Index() {
  useLoad(() => {
    console.log('Page loaded.')
  })

  return (
    <View className='flex h-full min-h-0 flex-col bg-page-bg p-4'>
      <Text className='text-lg font-semibold text-text'>首页（排练 + 签到）</Text>
      <Text className='mt-1 text-sm text-text-muted'>第 1 周实现：排练列表 + 签到码弹窗</Text>
    </View>
  )
}
