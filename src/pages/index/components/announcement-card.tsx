import { View, Text } from '@tarojs/components'
import { Card } from '@/components/ui/Card'
import { formatDateTimeInChina } from '@/lib/date-utils'
import { useT } from '@/i18n'
import type { AnnouncementRow } from '@/types/database'

type Props = {
  item: AnnouncementRow
  /** 是否为过期公告（历史合排 tab） */
  isExpired?: boolean
}

export function AnnouncementCard({ item, isExpired = false }: Props) {
  const { t } = useT()

  const cardClass = isExpired
    ? 'rounded-lg border border-border bg-card p-3 text-sm shadow-sm'
    : 'rounded-lg border border-warning bg-warning-bg p-3 text-sm shadow-sm'

  const titleClass = isExpired ? 'text-primary' : 'text-warning'
  const contentClass = isExpired ? 'text-primary' : 'text-warning'
  const timeClass = isExpired ? 'text-text-muted' : 'text-warning/70'

  return (
    <Card className={cardClass}>
      <View>
        <Text className={`block text-base font-normal ${titleClass}`}>
          {item.title || t('home.announcementDefaultTitle')}
        </Text>
        <Text className={`mt-1 block text-sm leading-relaxed ${contentClass}`}>
          {item.content}
        </Text>
        <Text className={`mt-1 block text-sm ${timeClass}`}>
          {t('home.publishTime', { time: formatDateTimeInChina(item.created_at ?? null) })}
        </Text>
      </View>
    </Card>
  )
}