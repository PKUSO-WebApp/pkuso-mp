import type { ReactNode } from 'react'
import { Text, View } from '@tarojs/components'

export interface PageHeaderProps {
  title: string
  subtitle?: string
  /** 标题行右侧的按钮/操作区（如「添加预约」）。无则不渲染。 */
  rightButton?: ReactNode
}

/** 统一的页面主/副标题显示组件，所有 tab 页共用，避免切换页面时标题高度跳动。 */
export function PageHeader({ title, subtitle, rightButton }: PageHeaderProps) {
  return (
    <View className='flex items-center justify-between gap-2'>
      <View className='min-w-0'>
        <Text className='text-lg font-semibold text-text'>{title}</Text>
        {subtitle ? <Text className='mt-1 block text-xs text-text-muted'>{subtitle}</Text> : null}
      </View>
      {rightButton ? <View className='shrink-0'>{rightButton}</View> : null}
    </View>
  )
}
