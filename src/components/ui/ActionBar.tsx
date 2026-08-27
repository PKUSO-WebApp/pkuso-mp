import type { ReactNode } from 'react'
import { View } from '@tarojs/components'

// 右下角操作行（双按钮 / 单主操作按钮均右对齐，gap-2）。
// 例外：仅「关闭」按钮、全宽平分确认块不归此处。
export function ActionBar({
  className = '',
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return <View className={`flex items-center justify-end gap-2 ${className}`}>{children}</View>
}
