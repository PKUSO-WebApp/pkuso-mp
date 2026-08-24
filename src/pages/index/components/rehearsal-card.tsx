import { View, Text } from '@tarojs/components'
import { Card } from '@/components/ui/Card'
import { formatRehearsalRange } from '@/lib/date-utils'
import { getUpdateBadgeLabel } from '@/lib/rehearsal-sort'
import type { RehearsalRow } from '@/types/database'

type Props = {
  item: RehearsalRow
  /** 整卡点击打开详情页 */
  onClick?: () => void
  /** 编辑过（updated_at > created_at），展示「更新」提示 */
  isUpdated?: boolean
  /** 该排练是否已被查看过；未查看时右上角显示红色气泡（localStorage 跟踪） */
  seen?: boolean
}

export function RehearsalCard({ item, onClick, isUpdated, seen }: Props) {
  const updateLabel = isUpdated ? getUpdateBadgeLabel(item) : null

  return (
    <Card onClick={onClick} className='relative'>
      <View className='flex gap-3'>
        {/* 排练信息（时间/地点/更新提示 chip） */}
        <View className='min-w-0 flex-1 space-y-1 leading-tight'>
          <Text className='block text-base font-semibold text-text'>
            {item.start_time
              ? formatRehearsalRange(item.start_time, item.end_time ?? null)
              : '时间未设置'}
          </Text>
          {updateLabel && (
            <Text className='inline-block rounded bg-warning-bg/80 px-1.5 py-1 text-xs text-warning'>
              {updateLabel}
            </Text>
          )}
          <Text className='block text-xs text-text-muted'>
            {item.location || '未定'}
            {item.type === 'section' && item.target_section
              ? ` · 针对：${item.target_section}`
              : ''}
          </Text>
        </View>
      </View>
      {/* 未查看红气泡：打开详情页（markRehearsalSeen）后消失 */}
      {!seen && (
        <View
          className='absolute right-0 top-0'
          style={{ width: '8px', height: '8px', borderRadius: '4px', background: '#de2626' }}
        />
      )}
    </Card>
  )
}
