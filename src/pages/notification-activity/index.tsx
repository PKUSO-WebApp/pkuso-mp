import { useState } from 'react'
import { NotificationList } from '@/pages/notifications/notification-list'
import { SegmentTabs } from '@/components/ui/SegmentTabs'
import { useT, useNavTitle } from '@/i18n'
import type { PostType } from '@/types/database'
import './index.scss'

const ACTIVITY_TABS: { key: PostType | 'all'; labelKey: 'notification.activityTabs.all' | 'notification.activityTabs.ensemble' | 'notification.activityTabs.gathering' }[] = [
  { key: 'all', labelKey: 'notification.activityTabs.all' },
  { key: 'ensemble', labelKey: 'notification.activityTabs.ensemble' },
  { key: 'gathering', labelKey: 'notification.activityTabs.gathering' },
]

/**
 * 活动页（「我的-通知-活动」进入）。
 * 三 tab（全部/重奏/团建）当前仅作 UI 占位：notifications 表尚未携带帖子类型字段，
 * 故三个 tab 均展示同一份「活动通知」列表；待后端补齐 post_type 后再做实筛选。
 * tab 切换组件与「我的请假」页（SegmentTabs）保持一致。
 */
export default function NotificationActivityPage() {
  const { t } = useT()
  useNavTitle('notification.activityNavTitle')
  const [view, setView] = useState<PostType | 'all'>('all')

  const tabs = ACTIVITY_TABS.map((tab) => ({ key: tab.key, label: t(tab.labelKey) }))

  return (
    <NotificationList
      category='activity'
      title={t('notification.activityTitle')}
      topSlot={<SegmentTabs tabs={tabs} value={view} onChange={(k) => setView(k)} />}
    />
  )
}
