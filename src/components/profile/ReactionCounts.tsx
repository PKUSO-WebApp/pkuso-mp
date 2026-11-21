import { Text, View } from '@tarojs/components'
import { formatReactionCount } from '@/lib/reaction-count'

/** 成员卡片右上角的点赞 / 送花计数（只展示，不发请求） */
export function ReactionCounts({
  likes,
  flowers,
}: {
  likes: number | null
  flowers: number | null
}) {
  return (
    <View className='flex shrink-0 items-center gap-2'>
      <Text className='text-xs text-text-muted'>👍 {formatReactionCount(likes)}</Text>
      <Text className='text-xs text-text-muted'>💐 {formatReactionCount(flowers)}</Text>
    </View>
  )
}
