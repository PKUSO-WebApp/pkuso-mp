import { Text, View } from '@tarojs/components'

type Props = {
  count: number
  /** 分段 tab 里用更小的尺寸 */
  compact?: boolean
  className?: string
}

/** 未处理数徽章：固定高度 + 最小宽度，保证 1 位数也是圆形而不是椭圆。 */
export function CountBadge({ count, compact = false, className = '' }: Props) {
  if (count <= 0) return null
  return (
    <View
      className={`inline-flex items-center justify-center rounded-full bg-danger ${
        compact ? 'h-4 min-w-[16px] px-1' : 'h-5 min-w-[20px] px-1.5'
      } ${className}`}
    >
      <Text
        className={`font-medium leading-none text-danger-foreground ${
          compact ? 'text-[10px]' : 'text-xs'
        }`}
      >
        {count > 99 ? '99+' : count}
      </Text>
    </View>
  )
}
