import type { CSSProperties } from 'react'
import { View } from '@tarojs/components'

type UnreadDotProps = {
  className?: string
  style?: CSSProperties
}

/** 最小未读红点（8px 圆）：颜色统一走 --color-danger token，暗色模式自动跟随 */
export function UnreadDot({ className = '', style }: UnreadDotProps) {
  return <View className={`h-2 w-2 rounded-full bg-danger ${className}`} style={style} />
}
