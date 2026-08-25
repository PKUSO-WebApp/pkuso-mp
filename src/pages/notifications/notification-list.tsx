import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { View, Text } from '@tarojs/components'
import type { NotificationCategory, NotificationRow } from '@/types/database'
import { useNotifications } from '@/hooks/useNotifications'
import { notifyNotificationsUpdated } from '@/components/notification-badge-sync'
import { formatDateTimeInChina } from '@/lib/date-utils'
import { useT } from '@/i18n'

type Props = {
  category: NotificationCategory
  title: string
  /** 列表上方的自定义插槽（如活动页的三 tab 切换，当前仅 UI 占位） */
  topSlot?: ReactNode
}

/**
 * 通知信箱页主体（活动 / 系统共用）：挂载即拉取该分类消息（created_at 倒序），
 * fetch 成功后才标记本次展示的未读行为已读（打开瞬间到达的新通知不会被误标）；
 * fetch 失败不标已读（用户未看到消息）。标记已读后广播事件，同步「我的」页红点。
 */
export function NotificationList({ category, title, topSlot }: Props) {
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

  return (
    <View className='pk-page min-h-screen bg-bg px-4 py-4'>
      {topSlot}
      <Text className='block text-lg font-semibold text-text'>{title}</Text>
      <View className='mt-3'>
        {loading ? (
          <Text className='block py-10 text-center text-xs text-text-muted'>{t('common.actions.loading')}</Text>
        ) : failed ? (
          <Text className='block py-10 text-center text-sm text-text-muted'>{t('notification.list.failed')}</Text>
        ) : messages.length === 0 ? (
          <Text className='block py-10 text-center text-sm text-text-muted'>{t('notification.list.empty')}</Text>
        ) : (
          messages.map((msg) => (
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
