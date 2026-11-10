import { View, Image } from '@tarojs/components'
import defaultAvatar from '@/assets/icons/user-round.png'

/**
 * 默认头像（用户没上传头像时的兜底）。
 *
 * - 新图标是**实心**的，与旧描边版同尺寸时看起来更重、更大；这里在头像容器内缩到
 *   85%，让视觉大小回到旧版；
 * - 完全透明无边框观感偏怪，所以补一层最浅的中性圆底 + 1px 边框。用语义 token
 *   （`bg-muted` / `border-border`）而不是硬编码色值，亮暗模式自动跟随。
 *
 * **只用于默认头像** —— 用户上传的真实头像仍走满框 `aspectFill`，不要在这里缩。
 */
export function DefaultAvatar() {
  return (
    <View className='flex h-full w-full items-center justify-center rounded-full border border-border bg-muted'>
      <Image src={defaultAvatar} className='h-[85%] w-[85%]' mode='aspectFit' />
    </View>
  )
}
