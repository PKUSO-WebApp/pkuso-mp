import { useState } from 'react'
import { View } from '@tarojs/components'
import { NotificationList } from '@/pages/notifications/notification-list'
import { SegmentTabs } from '@/components/ui/SegmentTabs'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import type { PostType } from '@/types/database'
import './index.scss'

const ACTIVITY_TABS: { key: PostType | 'all'; labelKey: 'notification.activityTabs.all' | 'notification.activityTabs.ensemble' | 'notification.activityTabs.gathering' }[] = [
  { key: 'all', labelKey: 'notification.activityTabs.all' },
  { key: 'ensemble', labelKey: 'notification.activityTabs.ensemble' },
  { key: 'gathering', labelKey: 'notification.activityTabs.gathering' },
]

/**
 * 活动页（「我的-通知-活动」进入）。
 * 三 tab（全部/重奏/团建）：notifications 表暂无 post_type 字段，
 * 按 Web 管理端固定文案模板「你的{重奏|团建}帖子《…》…」做客户端归类
 * （activity-notification.ts）；未命中的通知仅在「全部」tab 展示。
 * 后端补 post_type 后，此处退化为 fallback 即可。
 */
export default function NotificationActivityPage() {
  const { t } = useT()
  useNavTitle('notification.activityNavTitle')
  const darkClass = useThemeClass()
  const [view, setView] = useState<PostType | 'all'>('all')

  const tabs = ACTIVITY_TABS.map((tab) => ({ key: tab.key, label: t(tab.labelKey) }))

  return (
    <View className={`${darkClass} min-h-full bg-page-bg`}>
      <NotificationList
        category='activity'
        title={t('notification.activityTitle')}
        topSlot={<SegmentTabs tabs={tabs} value={view} onChange={(k) => setView(k)} />}
        typeFilter={view}
      />
    </View>
  )
}
