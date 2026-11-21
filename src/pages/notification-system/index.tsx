import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useDidHide } from '@tarojs/taro'
import { useNotifications } from '@/hooks/useNotifications'
import { SegmentTabs } from '@/components/ui/SegmentTabs'
import { ListState } from '@/components/ui/ListState'
import { formatDateTimeInChina } from '@/lib/date-utils'
import { noticeText } from '@/lib/notification-text'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import type { NotificationCategory, NotificationRow } from '@/types/database'
import './index.scss'

type Tab = 'unread' | 'all'

/**
 * 全部通知页（「我的-通知」进入）：
 * 合并展示系统、活动、考勤与请假三类（声部请假是声部长/首席工作台，仍在独立页面）。
 * 服务端 read_at 作为已读唯一来源（非本地存储）。
 * 顶部「未读 / 全部」分段切换，默认进入「未读」。
 * 快照式曝光即已读：进入页面立即把本次拉取到的未读全部标为已读（红点即时清零），
 * 但本会话内以「打开时的未读快照」决定归属——刚被标读的那些仍留在未读 tab，
 * 切到「全部」时与已读项一起显示。初始标记失败的行由离开时的兜底提交重试。
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
        // 本页不拉 section_leave；留空以保持 Record 的穷举性
        section_leave: [],
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
              setMessages((prev) =>
                prev.map((m) => (ids.includes(m.id) ? { ...m, read_at: now } : m))
              )
            } else {
              ids.forEach((id) => handledRef.current.delete(id))
            }
            return ok
          })
      ).then((results) => results.some(Boolean))
    },
    [markCategoryRead]
  )

  // 抽成具名函数：失败态的「重试」要重跑的就是这一段（原来写死在 effect 里，失败后只能退出重进）
  const load = useCallback(() => {
    setLoading(true)
    setFailed(false)
    const seq = ++seqRef.current
    return Promise.all([
      fetchByCategory('system'),
      fetchByCategory('activity'),
      fetchByCategory('attendance'),
    ]).then(([sys, act, att]) => {
      if (seq !== seqRef.current) return
      setLoading(false)
      // 三类任一成功即展示该类；仅当三类都失败才标记整体失败
      setFailed(sys.error !== null && act.error !== null && att.error !== null)
      const sysRows = sys.error ? [] : sys.rows
      const actRows = act.error ? [] : act.rows
      const attRows = att.error ? [] : att.rows
      // 合并三类并按创建时间倒序
      const merged = [...sysRows, ...actRows, ...attRows].sort((a, b) =>
        a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
      )
      setMessages(merged)
      const unreadIds = merged.filter((m) => m.read_at === null).map((m) => m.id)
      setSnapshotIds(new Set(unreadIds))
      // 重试时 handledRef 里那批「已提交过」的 id 会被 markReadFor 自己跳过，不会重复标读
      if (unreadIds.length > 0) void markReadFor(merged)
    })
  }, [fetchByCategory, markReadFor])

  useEffect(() => {
    void load()
    // 不带卸载守卫：原代码在页面离开后仍会把拉到的未读标读（「曝光即已读」），
    // 加了守卫等于悄悄改掉这个语义。重试的乱序由 load 里的 seq 比对兜住
  }, [load])

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
    { key: 'all' as Tab, label: t('notification.systemTabs.all') },
  ]
  const visible = useMemo(
    () => (tab === 'unread' ? messages.filter((m) => snapshotIds.has(m.id)) : messages),
    [messages, snapshotIds, tab]
  )

  return (
    <View className={`${darkClass} pk-page min-h-screen bg-page-bg`}>
      <View className='mb-3'>
        <SegmentTabs tabs={tabs} value={tab} onChange={(k) => setTab(k)} />
      </View>
      <View className='px-4'>
        <ListState
          loading={loading}
          loadingOnlyWhenEmpty={false}
          error={failed ? t('notification.list.failed') : null}
          isEmpty={visible.length === 0}
          emptyText={
            tab === 'unread' ? t('notification.emptyUnread') : t('notification.list.empty')
          }
          onRetry={() => void load()}
        >
          {visible.map((msg) => {
            // 服务端只落一条行，**语言在这里定**：认得的 kind 走 i18n，其余原样显示服务端文案
            //（见 lib/notification-text.ts）
            const time = formatDateTimeInChina(msg.created_at)
            const text = noticeText(msg, time, t)
            // 考勤类通知可能带排练 id（请假页原先把这类通知做成可点）；搬家后保留跳转
            const meta = msg.meta as { rehearsal_id?: unknown } | null
            const rehearsalId = typeof meta?.rehearsal_id === 'number' ? meta.rehearsal_id : null
            return (
              <View
                key={msg.id}
                className='relative mb-2 rounded-xl border border-border bg-card p-3'
                onClick={
                  rehearsalId
                    ? () =>
                        void Taro.navigateTo({
                          url: `/pages/rehearsal-detail/index?id=${rehearsalId}`,
                        })
                    : undefined
                }
              >
                <View className='flex items-start justify-between gap-2 pr-16'>
                  <Text className='min-w-0 flex-1 text-sm font-medium text-text'>{text.title}</Text>
                  <View className='flex flex-shrink-0 items-center gap-1'>
                    <Text className='text-xs text-text-muted'>{time}</Text>
                    {rehearsalId ? <Text className='text-sm text-text-muted'>›</Text> : null}
                  </View>
                </View>
                <Text className='mt-1 block whitespace-pre-line text-xs leading-relaxed text-text-muted'>
                  {text.content}
                </Text>
              </View>
            )
          })}
        </ListState>
      </View>
    </View>
  )
}
