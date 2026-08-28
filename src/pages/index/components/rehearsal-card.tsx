import { View, Text } from '@tarojs/components'
import { Card } from '@/components/ui/Card'
import { UnreadDot } from '@/components/ui/UnreadDot'
import { StatusChip } from '@/components/ui/StatusChip'
import { formatRehearsalRange } from '@/lib/date-utils'
import { getUpdatedFields } from '@/lib/rehearsal-sort'
import { useT } from '@/i18n'
import { translateInstrument } from '@/lib/instrument-i18n'
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
  const { t } = useT()
  const updatedFields = isUpdated ? getUpdatedFields(item) : null

  return (
    <Card onClick={onClick} className='relative'>
      <View className='flex gap-3'>
        {/* 排练信息（时间/地点/更新提示 chip） */}
        <View className='min-w-0 flex-1 leading-tight'>
          <Text className='block text-base font-normal text-text'>
            {item.start_time
              ? formatRehearsalRange(item.start_time, item.end_time ?? null)
              : t('home.rehearsalTimeUnset')}
          </Text>
          {updatedFields && updatedFields.length > 0 && (
            <StatusChip tone='warning' className='mt-1'>
              {t('home.updated', {
                fields: updatedFields
                  .map((f) => t(`home.updatedField.${f}`))
                  .join('/'),
              })}
            </StatusChip>
          )}
          <Text className='mt-1 block text-xs text-text-muted'>
            {item.location || t('home.locationUnset')}
            {item.type === 'section' && item.target_section
              ? ` · ${t('home.targetSection')}${translateInstrument(item.target_section, t)}`
              : ''}
          </Text>
        </View>
      </View>
      {/* 未查看红气泡：打开详情页（markRehearsalSeen）后消失 */}
      {!seen && <UnreadDot className='absolute right-0 top-0' />}
    </Card>
  )
}
