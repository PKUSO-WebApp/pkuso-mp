import { Button, View } from '@tarojs/components'
import type { ReactNode } from 'react'

type CardProps = {
  children: ReactNode
  className?: string
  onClick?: () => void
}

export function Card({ children, className = '', onClick }: CardProps) {
  // text-sm 同时用于 View/Button 两种形态，保证文字字号一致；
  // 可点形态用 text-left 对齐 Web 版（小程序无鼠标态，Web 的 cursor/hover 反馈不适用）
  const base = 'rounded-2xl border border-border bg-card p-3 text-sm'
  const shadow = 'shadow-sm'
  // m-0：重置微信基础库 button 默认 margin-left/right:auto（否则按钮收缩居中，与 View 形态不一致）
  const interactive = onClick ? 'm-0 text-left' : ''

  if (onClick) {
    return (
      <Button
        hoverClass='none'
        className={`${base} ${shadow} ${interactive} leading-normal ${className}`.trim()}
        onClick={onClick}
      >
        {children}
      </Button>
    )
  }

  return <View className={`${base} ${shadow} ${className}`.trim()}>{children}</View>
}
