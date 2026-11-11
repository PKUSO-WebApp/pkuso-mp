import { Text, View } from '@tarojs/components'

type Props = {
  count: number
  className?: string
}

/**
 * 未处理数徽章。
 * 布局必须与「我的」页通知栏目的未读徽章完全一致（`src/pages/profile/index.tsx`）：
 * 同一套类名（flex / h-5 / min-w-5 / px-1.5 / text-xs），不要在这里另起尺寸。
 * ⚠️ 最小宽度必须用 `min-w-5`（= `--spacing * 5`，40rpx），不能用 `min-w-[20px]`：
 * 后者会被编译成 20rpx，只有 h-5 的一半，1 位数会渲染成竖直的椭圆。
 */
export function CountBadge({ count, className = '' }: Props) {
  if (count <= 0) return null
  return (
    <View
      className={`flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 ${className}`}
    >
      <Text className='text-xs font-medium leading-none text-danger-foreground'>
        {count > 99 ? '99+' : count}
      </Text>
    </View>
  )
}
