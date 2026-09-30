import { View, Text } from '@tarojs/components'
import { Card } from '@/components/ui/Card'
import { UnreadDot } from '@/components/ui/UnreadDot'
import { StatusChip } from '@/components/ui/StatusChip'
import { formatRehearsalCardParts } from '@/lib/date-utils'
import { getUpdatedFields } from '@/lib/rehearsal-sort'
import { useT } from '@/i18n'
import { getSectionGroupLabel } from '@/constants/instruments'
import { normalizeTargets } from '@/lib/rehearsal-utils'
import type { RehearsalRow } from '@/types/database'

type Props = {
  item: RehearsalRow
  onClick?: () => void
  isUpdated?: boolean
  seen?: boolean
}

export function RehearsalCard({ item, onClick, isUpdated, seen }: Props) {
  const { t } = useT()
  const updatedFields = isUpdated ? getUpdatedFields(item) : null

  const { dateLabel, weekdayLabel, timeRange } = item.start_time
    ? formatRehearsalCardParts(item.start_time, item.end_time ?? null)
    : { dateLabel: '', weekdayLabel: '', timeRange: t('home.rehearsalTimeUnset') }

  const typeLabel = item.type === 'section' ? t('home.tabs.section') : t('home.tabs.full')

  return (
    <Card onClick={onClick} className='relative'>
      <View className='min-w-0 leading-tight'>
        {/* Line 1: 日期 + 合排/分排 */}
        <Text className='block text-base font-normal text-primary'>
          {dateLabel} {typeLabel}
        </Text>

        {/* Line 2: 星期 + 时间段 */}
        <Text className='mt-1 block text-sm leading-relaxed text-primary'>
          {weekdayLabel} {timeRange}
        </Text>

        {/* Line 3: 曲目（最多两行，超出省略） */}
        {item.repertoire && (
          <Text className='mt-1 block text-sm leading-relaxed text-primary line-clamp-2'>
            {item.repertoire}
          </Text>
        )}

        {/* Line 4: 地点 */}
        <Text className='mt-1 block text-sm text-text-muted'>
          {item.location || t('home.locationUnset')}
          {item.type === 'section' && item.target_section
            ? ` · ${t('home.targetSection')}${getSectionGroupLabel(normalizeTargets(item.target_section))}`
            : ''}
        </Text>

        {updatedFields && updatedFields.length > 0 && (
          <StatusChip tone='warning' className='absolute right-4 top-2'>
            {t('home.updated', {
              fields: updatedFields.map((f) => t(`home.updatedField.${f}`)).join('/'),
            })}
          </StatusChip>
        )}
      </View>

      {!seen && <UnreadDot className='absolute right-0 top-0' />}
    </Card>
  )
}
