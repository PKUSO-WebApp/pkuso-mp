import { Text, View } from '@tarojs/components'
import { formatReactionCount } from '@/lib/reaction-count'

/**
 * 成员卡片右上角的点赞 / 送花计数（只展示，不发请求）。
 * 计数为 0 的那一项不显示（两项都为 0 时整块不渲染），避免卡片上出现「👍 0」。
 */
export function ReactionCounts({
  likes,
  flowers,
}: {
  likes: number | null
  flowers: number | null
}) {
  const showLikes = (likes ?? 0) > 0
  const showFlowers = (flowers ?? 0) > 0
  if (!showLikes && !showFlowers) return null
  return (
    <View className='flex shrink-0 items-center gap-2'>
      {showLikes && (
        <Text className='text-xs text-text-muted'>👍 {formatReactionCount(likes)}</Text>
      )}
      {showFlowers && (
        <Text className='text-xs text-text-muted'>💐 {formatReactionCount(flowers)}</Text>
      )}
    </View>
  )
}
