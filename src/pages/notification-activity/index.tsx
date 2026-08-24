import { useState } from 'react'
import { NotificationList } from '@/pages/notifications/notification-list'
import { SegmentTabs } from '@/components/ui/SegmentTabs'
import type { PostType } from '@/types/database'
import './index.scss'

const ACTIVITY_TABS: { key: PostType | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'ensemble', label: '重奏' },
  { key: 'gathering', label: '团建' },
]

/**
 * 活动页（「我的-通知-活动」进入）。
 * 三 tab（全部/重奏/团建）当前仅作 UI 占位：notifications 表尚未携带帖子类型字段，
 * 故三个 tab 均展示同一份「活动通知」列表；待后端补齐 post_type 后再做实筛选。
 * tab 切换组件与「我的请假」页（SegmentTabs）保持一致。
 */
export default function NotificationActivityPage() {
  const [view, setView] = useState<PostType | 'all'>('all')

  return (
    <NotificationList
      category='activity'
      title='活动通知'
      topSlot={<SegmentTabs tabs={ACTIVITY_TABS} value={view} onChange={(k) => setView(k)} />}
    />
  )
}
