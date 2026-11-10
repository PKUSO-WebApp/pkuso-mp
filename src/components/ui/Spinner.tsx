import { View } from '@tarojs/components'
import './Spinner.scss'

/**
 * 转圈加载指示器（0.6.2）：整页加载与区块加载统一用它，不再用「加载中」文字。
 *
 * 颜色走语义 token（边框灰环 + 主色缺口），亮/暗模式都由 tokens 决定；
 * 尺寸用类名（`h-6` / `h-8`），与项目其余控件一样交给 Taro 的 pxtransform。
 */
export function Spinner({
  size = 'md',
  className = '',
}: {
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <View
      className={`ui-spinner rounded-full border-2 ${
        size === 'sm' ? 'h-6 w-6' : 'h-8 w-8'
      } ${className}`}
    />
  )
}
