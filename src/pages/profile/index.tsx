import { View, Text } from '@tarojs/components'
import './index.scss'

export default function Profile() {
  return (
    <View className='flex flex-1 flex-col items-center justify-center gap-2 bg-page-bg p-4'>
      <Text className='text-lg font-semibold text-text'>我的</Text>
      <Text className='text-sm text-text-muted'>个人信息，第 2 周实现</Text>
    </View>
  )
}