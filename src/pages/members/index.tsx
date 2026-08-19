import { View, Text } from '@tarojs/components'
import './index.scss'

export default function Members() {
  return (
    <View className='flex flex-1 flex-col items-center justify-center gap-2 bg-page-bg p-4'>
      <Text className='text-lg font-semibold text-text'>成员</Text>
      <Text className='text-sm text-text-muted'>花名册（声部分组 + 拼音搜索），第 2 周实现</Text>
    </View>
  )
}