import { View } from '@tarojs/components'
import type { ReactNode } from 'react'

type CardProps = {
  children: ReactNode
  className?: string
  onClick?: () => void
}

export function Card({ children, className = '', onClick }: CardProps) {
  // text-sm 两种形态共用，保证文字字号一致；
  // 可点形态用 text-left 对齐 Web 版（小程序无鼠标态，Web 的 cursor/hover 反馈不适用）
  const base = 'rounded-2xl border border-border bg-card p-3 text-sm'
  const shadow = 'shadow-sm'
  const interactive = onClick ? 'text-left' : ''

  return (
    // 可点形态刻意用 View 而非原生 Button：微信原生 button 的事件模型特殊，
    // 子元素 catchtap（stopPropagation）挡不住它的 tap——卡片内嵌套签到按钮时
    // 点签到会误触发整卡点击（用户实测）。View 的事件冒泡模型正常，
    // 子元素 catchtap 可正确阻断父级 tap。
    <View className={`${base} ${shadow} ${interactive} ${className}`.trim()} onClick={onClick}>
      {children}
    </View>
  )
}
