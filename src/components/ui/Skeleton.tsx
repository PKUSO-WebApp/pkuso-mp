import { View } from '@tarojs/components'
import './Skeleton.scss'

export function Skeleton({ className = '' }: { className?: string }) {
  return <View className={`skeleton ${className}`} />
}

export function SkeletonCircle({ className = '', size = 48 }: { className?: string; size?: number }) {
  return <View className={`skeleton-circle ${className}`} style={{ width: size, height: size }} />
}

export function SkeletonText({
  className = '',
  lines = 1,
  lineHeight = 16,
  gap = 4,
}: { className?: string; lines?: number; lineHeight?: number; gap?: number }) {
  return (
    <View className={`skeleton-text ${className}`} style={{ flex: 1, gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <View key={i} className='skeleton-line' style={{ height: lineHeight }} />
      ))}
    </View>
  )
}

export function SkeletonCard({ className = '', children }: { className?: string; children?: React.ReactNode }) {
  return <View className={`skeleton-card ${className}`}>{children}</View>
}