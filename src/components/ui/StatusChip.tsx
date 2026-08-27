import type { ReactNode } from 'react'
import { View } from '@tarojs/components'

export type StatusTone = 'success' | 'danger' | 'warning' | 'neutral'

const TONE_CLASS: Record<StatusTone, string> = {
  success: 'bg-success-bg text-success',
  danger: 'bg-danger-bg text-danger',
  warning: 'bg-warning-bg text-warning',
  neutral: 'bg-muted text-text-muted',
}

export function StatusChip({
  tone = 'neutral',
  className = '',
  children,
}: {
  tone?: StatusTone
  className?: string
  children: ReactNode
}) {
  return (
    <View
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </View>
  )
}
