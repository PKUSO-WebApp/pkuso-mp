import { View, Text } from '@tarojs/components'

type FieldRowProps = {
  label: string
  value: string | null | undefined
  /** inline=标签左·值右单行（弹窗摘要）；stacked=标签上·值下（详情正文） */
  layout?: 'inline' | 'stacked'
  className?: string
}

/**
 * 只读字段行（P2-3 合一）：原 members/member-detail-modal 的 DetailField 与
 * rehearsal-detail 的 DetailRow 为同名异构复制，统一为本组件的两个布局。
 * inline 变体空值兜底「—」；stacked 变体保持原样（由调用方自行兜底文案）。
 */
export function FieldRow({ label, value, layout = 'inline', className = '' }: FieldRowProps) {
  if (layout === 'stacked') {
    return (
      <View className={`mb-3 ${className}`}>
        <Text className='block text-sm font-medium text-text'>{label}</Text>
        <Text className='mt-1 block text-sm text-text-muted'>{value}</Text>
      </View>
    )
  }
  return (
    <View className={`flex items-baseline justify-between gap-3 ${className}`}>
      <Text className='shrink-0 text-xs text-text-muted'>{label}</Text>
      <Text className='min-w-0 break-words text-right text-sm text-text'>
        {value?.trim() || '—'}
      </Text>
    </View>
  )
}
