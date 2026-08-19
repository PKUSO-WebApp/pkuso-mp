import { View, Text } from '@tarojs/components'
import './index.scss'

export default function Community() {
  return (
    <View className='flex flex-1 flex-col items-center justify-center gap-2 bg-page-bg p-4'>
      <Text className='text-lg font-semibold text-text'>社区</Text>
      <Text className='text-sm text-text-muted'>demo 阶段占位，第 3~4 周实现</Text>
    </View>
  )
}
