import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text } from '@tarojs/components'
import { useDidHide } from '@tarojs/taro'
import { useNotifications } from '@/hooks/useNotifications'
import { SegmentTabs } from '@/components/ui/SegmentTabs'
import { formatDateTimeInChina } from '@/lib/date-utils'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import type { NotificationCategory, NotificationRow } from '@/types/database'
import './index.scss'

type Tab = 'unread' | 'read'

/**
 * 系统通知页（「我的-通知-系统」进入）：
 * 合并展示「系统通知」与「活动通知」两类（活动通知并入系统通知显示），
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

  // 按分类把未读行批量标记已读（合并展示后两类都需标读）
  const markReadFor = useCallback(
    (source: NotificationRow[]) => {
      const pending = source.filter((m) => m.read_at === null && !handledRef.current.has(m.id))
      if (pending.length === 0) return Promise.resolve(false)
      pending.forEach((m) => handledRef.current.add(m.id))
      const byCat: Record<NotificationCategory, NotificationRow[]> = {
        attendance: [],
        activity: [],
        system: [],
      }
      pending.forEach((m) => {
        if (m.category in byCat) byCat[m.category].push(m)
      })
      return Promise.all(
        (Object.keys(byCat) as NotificationCategory[])
          .filter((c) => byCat[c].length > 0)
          .map(async (c) => {
            const ids = byCat[c].map((m) => m.id)
            const ok = await markCategoryRead(c, ids)
            if (ok) {
              const now = new Date().toISOString()
              setMessages((prev) => prev.map((m) => (ids.includes(m.id) ? { ...m, read_at: now } : m)))
            } else {
              ids.forEach((id) => handledRef.current.delete(id))
            }
            return ok
          })
      ).then((results) => results.some(Boolean))
    },
    [markCategoryRead]
  )

  useEffect(() => {
    const seq = ++seqRef.current
    void Promise.all([fetchByCategory('system'), fetchByCategory('activity')]).then(([sys, act]) => {
      if (seq !== seqRef.current) return
      setLoading(false)
      // 两类任一成功即展示该类；仅当两类都失败才标记整体失败
      setFailed(sys.error !== null && act.error !== null)
      const sysRows = sys.error ? [] : sys.rows
      const actRows = act.error ? [] : act.rows
      // 合并两类并按创建时间倒序
      const merged = [...sysRows, ...actRows].sort((a, b) =>
        a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
      )
      setMessages(merged)
      const unreadIds = merged.filter((m) => m.read_at === null).map((m) => m.id)
      setSnapshotIds(new Set(unreadIds))
      if (unreadIds.length > 0) void markReadFor(merged)
    })
  }, [fetchByCategory, markReadFor])

  // 兜底提交：仅处理初始标记失败（不在 handled 中）的未读行；服务端另有 .is("read_at", null) 守卫
  const submitUnreadReads = useCallback(() => {
    return markReadFor(messagesRef.current)
  }, [markReadFor])

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
      label:
        unreadCount > 0
          ? t('notification.systemTabs.unreadCount', { n: unreadCount })
          : t('notification.systemTabs.unread'),
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
    <View className={`${darkClass} pk-page min-h-screen bg-page-bg`}>
      <View className='mb-3'>
        <SegmentTabs tabs={tabs} value={tab} onChange={(k) => setTab(k)} />
      </View>
      <View className='px-4'>
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
