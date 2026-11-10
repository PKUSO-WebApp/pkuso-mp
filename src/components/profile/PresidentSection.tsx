import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useT } from '@/i18n'
import { useMyCapabilities } from '@/hooks/useMyCapabilities'
import { usePresidentPendingCounts } from '@/hooks/usePresidentPendingCounts'
import { CountBadge } from '@/components/ui/CountBadge'

type Row = {
  key: string
  label: string
  url: string
  badge?: number
}

/**
 * 「我的」页的团长入口区：按能力逐项显示，缓存优先，未加载完不闪。
 * 只有本轮已实现的入口才渲染；attendance / attendance_export 暂不放入口。
 */
export function PresidentSection() {
  const { t } = useT()
  const { hasCapability } = useMyCapabilities()
  const hasApproval =
    hasCapability('membership_approval') ||
    hasCapability('leave_approval') ||
    hasCapability('attendance_approval')
  const { counts } = usePresidentPendingCounts(hasApproval)

  const rows: Row[] = []
  if (hasCapability('rehearsal')) {
    rows.push({
      key: 'rehearsal',
      label: t('president.section.rehearsal'),
      url: '/pages/president-rehearsals/index',
    })
  }
  if (hasCapability('announcement')) {
    rows.push({
      key: 'announcement',
      label: t('president.section.announcement'),
      url: '/pages/president-announcements/index',
    })
  }
  if (hasApproval) {
    rows.push({
      key: 'approval',
      label: t('president.section.approval'),
      url: '/pages/president-approvals/index',
      badge: counts.membership + counts.leave + counts.attendance,
    })
  }

  if (rows.length === 0) return null

  return (
    <View className='mt-6'>
      <Text className='text-xs font-medium text-text-muted'>{t('president.section.title')}</Text>
      <View className='mt-2 overflow-hidden rounded-2xl border border-border bg-card'>
        {rows.map((row, index) => (
          <View
            key={row.key}
            className={`flex items-center px-4 py-3 ${
              index < rows.length - 1 ? 'border-b border-border' : ''
            }`}
            onClick={() => void Taro.navigateTo({ url: row.url })}
          >
            <Text className='min-w-0 flex-1 text-sm font-medium text-text'>{row.label}</Text>
            <CountBadge count={row.badge ?? 0} className='mr-2' />
            <Text className='text-lg leading-none text-text-muted'>›</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
