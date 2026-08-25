import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { View, Text } from '@tarojs/components'
import type { NotificationCategory, NotificationRow, PostType } from '@/types/database'
import { useNotifications } from '@/hooks/useNotifications'
import { notifyNotificationsUpdated } from '@/components/notification-badge-sync'
import { formatDateTimeInChina } from '@/lib/date-utils'
import { classifyActivityNotification } from '@/lib/activity-notification'
import { useT } from '@/i18n'

type Props = {
  category: NotificationCategory
  title: string
  /** 列表上方的自定义插槽（如活动页的三 tab 切换） */
  topSlot?: ReactNode
  /** 帖子类型筛选（活动页三 tab 用）：'all' 或未传 = 不过滤；按内容模板归类，未命中的仅留在「全部」 */
  typeFilter?: PostType | 'all'
}

/**
 * 通知信箱页主体（活动 / 系统共用）：挂载即拉取该分类消息（created_at 倒序），
 * fetch 成功后才标记本次展示的未读行为已读（打开瞬间到达的新通知不会被误标）；
 * fetch 失败不标已读（用户未看到消息）。标记已读后广播事件，同步「我的」页红点。
 * typeFilter 仅影响展示过滤，「标记已读」始终覆盖该分类全量（曝光语义不变）。
 */
export function NotificationList({ category, title, topSlot, typeFilter }: Props) {
  const { t } = useT()
  const { fetchByCategory, markCategoryRead } = useNotifications()
  const [messages, setMessages] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const seqRef = useRef(0)

  useEffect(() => {
    const seq = ++seqRef.current
    void fetchByCategory(category).then(({ rows, error }) => {
      if (seq !== seqRef.current) return
      setLoading(false)
      if (error) {
        setFailed(true)
        setMessages([])
        return
      }
      setMessages(rows)
      const unreadIds = rows.filter((m) => m.read_at === null).map((m) => m.id)
      if (unreadIds.length > 0) {
        void markCategoryRead(category, unreadIds).then(() => {
          notifyNotificationsUpdated()
        })
      }
    })
  }, [category, fetchByCategory, markCategoryRead])

  // 展示过滤：活动页按帖子类型 tab 筛选（内容模板归类，未命中仅留在「全部」）
  const visible = useMemo(() => {
    if (!typeFilter || typeFilter === 'all') return messages
    return messages.filter((m) => classifyActivityNotification(m.content) === typeFilter)
  }, [messages, typeFilter])

  return (
    <View className='pk-page min-h-screen bg-bg px-4 py-4'>
      {topSlot}
      <Text className='block text-lg font-semibold text-text'>{title}</Text>
      <View className='mt-3'>
        {loading ? (
          <Text className='block py-10 text-center text-xs text-text-muted'>{t('common.actions.loading')}</Text>
        ) : failed ? (
          <Text className='block py-10 text-center text-sm text-text-muted'>{t('notification.list.failed')}</Text>
        ) : visible.length === 0 ? (
          <Text className='block py-10 text-center text-sm text-text-muted'>{t('notification.list.empty')}</Text>
        ) : (
          visible.map((msg) => (
            <View key={msg.id} className='mb-2 rounded-xl border border-border bg-card p-3'>
              <View className='flex items-start justify-between gap-2'>
                <Text className='min-w-0 flex-1 text-sm font-medium text-text'>{msg.title}</Text>
                <Text className='flex-shrink-0 text-xs text-text-muted'>
                  {formatDateTimeInChina(msg.created_at)}
                </Text>
              </View>
              <Text className='mt-1 block whitespace-pre-line text-xs leading-relaxed text-text-muted'>
                {msg.content}
              </Text>
            </View>
          ))
        )}
      </View>
    </View>
  )
}
