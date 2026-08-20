import { useEffect, useRef, useState } from 'react'
import { View, Text } from '@tarojs/components'
import type { NotificationCategory, NotificationRow } from '@/types/database'
import type { NotificationListResult } from '@/hooks/useNotifications'
import { Modal } from '@/components/ui/Modal'
import { formatDateTimeInChina } from '@/lib/date-utils'

type Props = {
  category: NotificationCategory
  /** 信箱标题（父级传入，如「考勤与请假」） */
  label: string
  /** 拉取该分类消息列表（来自父级 useNotifications 实例，保证标记已读后计数同源归零） */
  fetchMessages: (category: NotificationCategory) => Promise<NotificationListResult>
  markCategoryRead: (category: NotificationCategory, ids: string[]) => Promise<boolean>
  onClose: () => void
}

/**
 * 通知信箱弹窗：挂载即拉取该分类消息（created_at 倒序），
 * fetch 成功后才标记本次展示的未读行为已读（打开瞬间到达的新通知不在 ids 内，
 * 不会被误标）；fetch 失败不标已读（用户未看到消息），显示「加载失败」。
 * 父级条件渲染挂载：打开时查询、关闭即卸载清态。
 */
export function NotificationInboxModal({
  category,
  label,
  fetchMessages,
  markCategoryRead,
  onClose,
}: Props) {
  const [messages, setMessages] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false) // 消息查询失败态（显示「加载失败」）
  const seqRef = useRef(0)

  useEffect(() => {
    const seq = ++seqRef.current
    void fetchMessages(category).then(({ rows, error }) => {
      // 仅最新一次查询的响应生效（快速切换信箱时丢弃过期响应）
      if (seq !== seqRef.current) return
      setLoading(false)
      if (error) {
        setFailed(true)
        setMessages([])
        return // fetch 失败不标已读
      }
      setMessages(rows)
      // 只标本次展示的未读行（已读行无需重复标记）；失败仅控制台记录，
      // 计数归零与否由 markCategoryRead 内部按 DB 结果决定
      const unreadIds = rows.filter((m) => m.read_at === null).map((m) => m.id)
      if (unreadIds.length > 0) {
        void markCategoryRead(category, unreadIds)
      }
    })
  }, [category, fetchMessages, markCategoryRead])

  return (
    <Modal open onClose={onClose} title={label} position='bottom'>
      <View className='mt-4 max-h-[60vh] space-y-3 overflow-y-auto'>
        {loading ? (
          <Text className='block py-6 text-center text-xs text-text-muted'>加载中…</Text>
        ) : failed ? (
          <Text className='block py-6 text-center text-sm text-text-muted'>
            加载失败，请稍后重试
          </Text>
        ) : messages.length === 0 ? (
          <Text className='block py-6 text-center text-sm text-text-muted'>暂无消息</Text>
        ) : (
          messages.map((msg) => (
            <View key={msg.id} className='rounded-xl border border-border bg-card p-3'>
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
    </Modal>
  )
}
