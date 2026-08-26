import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text } from '@tarojs/components'
import { useDidHide } from '@tarojs/taro'
import { useNotifications } from '@/hooks/useNotifications'
import { SegmentTabs } from '@/components/ui/SegmentTabs'
import { formatDateTimeInChina } from '@/lib/date-utils'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import type { NotificationRow } from '@/types/database'
import './index.scss'

type Tab = 'unread' | 'read'

/**
 * 系统通知页（「我的-通知-系统」进入）：
 * 服务端 read_at 作为已读唯一来源（与考勤/活动一致，非本地存储）。
 * 顶部「未读 / 已读」分段切换，默认进入「未读」。
 * 快照式曝光即已读：进入页面立即把本次拉取到的未读全部标为已读（红点即时清零），
 * 但本会话内以「打开时的未读快照」决定归属——刚被标读的那些仍留在未读 tab，
 * 下次进入才归入已读。初始标记失败的行由离开时的兜底提交重试。
 */
export default function NotificationSystemPage() {
  const { fetchByCategory, markCategoryRead } = useNotifications()
  const [messages, setMessages] = useState<NotificationRow[]>([])
  // 打开瞬间的未读 id 快照：本会话内 tab 归属以此为准，不受后续标读影响
  const [snapshotIds, setSnapshotIds] = useState<ReadonlySet<string>>(() => new Set())
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState<Tab>('unread')
  const seqRef = useRef(0)
  const darkClass = useThemeClass()
  // 已提交/提交中的 id 集合：防 StrictMode 双挂载与「进页主路径 × 离开兜底」重复提交
  const handledRef = useRef<Set<string>>(new Set())
  // 镜像最新列表：兜底提交需读到离开瞬间的数据而非挂载时的旧闭包
  const messagesRef = useRef<NotificationRow[]>([])
  messagesRef.current = messages
  const { t } = useT()
  useNavTitle('notification.systemNavTitle')

  useEffect(() => {
    const seq = ++seqRef.current
    void fetchByCategory('system').then(({ rows, error }) => {
      if (seq !== seqRef.current) return
      setLoading(false)
      if (error) {
        setFailed(true)
        setMessages([])
        setSnapshotIds(new Set())
        return
      }
      setMessages(rows)
      // 曝光即已读（主路径，页面存活期内执行，红点经 hook 内 emitSync 即时同步）
      const unreadIds = rows.filter((m) => m.read_at === null).map((m) => m.id)
      setSnapshotIds(new Set(unreadIds))
      if (unreadIds.length === 0) return
      unreadIds.forEach((id) => handledRef.current.add(id))
      void markCategoryRead('system', unreadIds).then((ok) => {
        if (!ok) {
          // 失败放行：交由离开页面的兜底提交重试
          unreadIds.forEach((id) => handledRef.current.delete(id))
        }
      })
    })
  }, [fetchByCategory, markCategoryRead])

  // 兜底提交：仅处理初始标记失败（不在 handled 中）的未读行；服务端另有 .is("read_at", null) 守卫
  const submitUnreadReads = useCallback(() => {
    const ids = messagesRef.current
      .filter((m) => m.read_at === null && !handledRef.current.has(m.id))
      .map((m) => m.id)
    ids.forEach((id) => handledRef.current.add(id))
    if (ids.length === 0) return Promise.resolve(false)
    return markCategoryRead('system', ids).then((ok) => {
      if (!ok) {
        // 失败放行，允许下次离开时重试
        ids.forEach((id) => handledRef.current.delete(id))
        return false
      }
      const now = new Date().toISOString()
      setMessages((prev) =>
        prev.map((m) => (m.read_at === null ? { ...m, read_at: now } : m))
      )
      // 红点/行内数字刷新由 hook 内 emitSync('notifications') 统一广播，此处无需重复触发
      return true
    })
  }, [markCategoryRead])

  // 兜底路径：didHide 与卸载清理双保险——只重试初始标记失败的行
  useDidHide(() => {
    void submitUnreadReads()
  })
  useEffect(() => {
    return () => {
      void submitUnreadReads()
    }
  }, [submitUnreadReads])

  const unreadCount = useMemo(() => snapshotIds.size, [snapshotIds])
  const tabs = [
    {
      key: 'unread' as Tab,
      label: unreadCount > 0 ? t('notification.systemTabs.unreadCount', { n: unreadCount }) : t('notification.systemTabs.unread'),
    },
    { key: 'read' as Tab, label: t('notification.systemTabs.read') },
  ]
  const visible = useMemo(
    () =>
      tab === 'unread'
        ? messages.filter((m) => snapshotIds.has(m.id))
        : messages.filter((m) => !snapshotIds.has(m.id)),
    [messages, snapshotIds, tab]
  )

  return (
    <View className={`${darkClass} pk-page min-h-screen bg-page-bg px-4 py-4`}>
      <Text className='block text-lg font-semibold text-text'>{t('notification.systemTitle')}</Text>
      <View className='mt-2'>
        <SegmentTabs tabs={tabs} value={tab} onChange={(k) => setTab(k)} />
      </View>
      <View className='mt-3'>
        {loading ? (
          <Text className='block py-10 text-center text-xs text-text-muted'>{t('common.actions.loading')}</Text>
        ) : failed ? (
          <Text className='block py-10 text-center text-sm text-text-muted'>{t('notification.list.failed')}</Text>
        ) : visible.length === 0 ? (
          <Text className='block py-10 text-center text-sm text-text-muted'>
            {tab === 'unread' ? t('notification.emptyUnread') : t('notification.list.empty')}
          </Text>
        ) : (
          visible.map((msg) => (
            <View key={msg.id} className='relative mb-2 rounded-xl border border-border bg-card p-3'>
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
          ))
        )}
      </View>
    </View>
  )
}
