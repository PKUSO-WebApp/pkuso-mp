import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useNotifications } from '@/hooks/useNotifications'
import { SegmentTabs } from '@/components/ui/SegmentTabs'
import { formatDateTimeInChina } from '@/lib/date-utils'
import { notifyNotificationsUpdated } from '@/components/notification-badge-sync'
import type { NotificationRow } from '@/types/database'
import './index.scss'

type Tab = 'all' | 'unread'

/**
 * 系统通知页（「我的-通知-系统」进入）：
 * 服务端 read_at 作为已读唯一来源（与考勤/活动一致，非本地存储）。
 * 顶部「全部 / 未读」分段切换；每条卡片右上角「标记已读」按钮，
 * 点击经 markItemRead 写服务端 read_at，即时从「未读」移出并同步「我的」红点。
 * 与活动/考勤不同：本页打开不自动全标已读，未读状态由用户逐条确认。
 */
export default function NotificationSystemPage() {
  const { fetchByCategory, markItemRead } = useNotifications()
  const [messages, setMessages] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState<Tab>('all')
  const seqRef = useRef(0)

  useEffect(() => {
    const seq = ++seqRef.current
    void fetchByCategory('system').then(({ rows, error }) => {
      if (seq !== seqRef.current) return
      setLoading(false)
      if (error) {
        setFailed(true)
        setMessages([])
        return
      }
      setMessages(rows)
    })
  }, [fetchByCategory])

  const handleMarkRead = async (id: string) => {
    const ok = await markItemRead('system', id)
    if (!ok) {
      void Taro.showToast({ title: '操作失败，请稍后重试', icon: 'none' })
      return
    }
    // 本地即时反映：该条 read_at 置为非空，移出「未读」tab
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, read_at: new Date().toISOString() } : m))
    )
    notifyNotificationsUpdated()
  }

  const unreadCount = useMemo(
    () => messages.filter((m) => m.read_at === null).length,
    [messages]
  )
  const tabs = [
    { key: 'all' as Tab, label: '全部' },
    { key: 'unread' as Tab, label: unreadCount > 0 ? `未读(${unreadCount})` : '未读' },
  ]
  const visible = useMemo(
    () => (tab === 'unread' ? messages.filter((m) => m.read_at === null) : messages),
    [messages, tab]
  )

  return (
    <View className='pk-page min-h-screen bg-bg px-4 py-4'>
      <Text className='block text-lg font-semibold text-text'>系统通知</Text>
      <View className='mt-2'>
        <SegmentTabs tabs={tabs} value={tab} onChange={(k) => setTab(k)} />
      </View>
      <View className='mt-3'>
        {loading ? (
          <Text className='block py-10 text-center text-xs text-text-muted'>加载中…</Text>
        ) : failed ? (
          <Text className='block py-10 text-center text-sm text-text-muted'>加载失败，请稍后重试</Text>
        ) : visible.length === 0 ? (
          <Text className='block py-10 text-center text-sm text-text-muted'>
            {tab === 'unread' ? '暂无未读通知' : '暂无消息'}
          </Text>
        ) : (
          visible.map((msg) => {
            const unread = msg.read_at === null
            return (
              <View key={msg.id} className='relative mb-2 rounded-xl border border-border bg-card p-3'>
                {unread && (
                  <View className='absolute right-2 top-2'>
                    <Button
                      hoverClass='none'
                      className='m-0 rounded-full border-none bg-primary px-2 py-1 text-xs leading-none text-primary-foreground'
                      onClick={() => void handleMarkRead(msg.id)}
                    >
                      标记已读
                    </Button>
                  </View>
                )}
                <View className='flex items-start justify-between gap-2 pr-16'>
                  <Text className='min-w-0 flex-1 text-sm font-medium text-text'>{msg.title}</Text>
                  <Text className='flex-shrink-0 text-xs text-text-muted'>
                    {formatDateTimeInChina(msg.created_at)}
                  </Text>
                </View>
                <Text className='mt-1 block whitespace-pre-line text-xs leading-relaxed text-text-muted'>
                  {msg.content}
                </Text>
              </View>
            )
          })
        )}
      </View>
    </View>
  )
}
