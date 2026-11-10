import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { useNotifications } from '@/hooks/useNotifications'
import { notifyNotificationsUpdated } from '@/components/notification-badge-sync'
import { SegmentTabs } from '@/components/ui/SegmentTabs'
import { ListState } from '@/components/ui/ListState'
import { StatusChip, type StatusTone } from '@/components/ui/StatusChip'
import { formatDateTimeInChina, formatRehearsalRange } from '@/lib/date-utils'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import type { LeaveRequestRow, LeaveStatus, NotificationRow } from '@/types/database'
import './index.scss'

type RehearsalMini = {
  type: string | null
  start_time: string | null
  end_time: string | null
}
type LeaveRequestWithRehearsal = LeaveRequestRow & { rehearsals: RehearsalMini | null }

const STATUS_TONE: Record<LeaveStatus, StatusTone> = {
  approved: 'success',
  rejected: 'danger',
  pending: 'warning',
  withdrawn: 'neutral',
  canceled: 'neutral',
}

type TabKey = 'all' | 'approved' | 'rejected' | 'pending'

export default function LeaveRequestsPage() {
  const { t } = useT()
  useNavTitle('leaveRequests.navTitle')
  const darkClass = useThemeClass()
  const [tab, setTab] = useState<TabKey>('all')
  const [requests, setRequests] = useState<LeaveRequestWithRehearsal[]>([])
  const [attendanceNotices, setAttendanceNotices] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const { fetchByCategory, markCategoryRead } = useNotifications()

  // 与排练卡片一致：section → 分排，其余 → 合排
  const rehearsalTypeLabel = (type: string | null): string =>
    type === 'section'
      ? t('leaveRequests.type.section')
      : type === 'full'
        ? t('leaveRequests.type.full')
        : type || t('leaveRequests.type.rehearsal')

  const statusLabels: Record<LeaveStatus, string> = {
    pending: t('leaveRequests.status.pending'),
    approved: t('leaveRequests.status.approved'),
    rejected: t('leaveRequests.status.rejected'),
    withdrawn: t('leaveRequests.status.withdrawn'),
    canceled: t('leaveRequests.status.canceled'),
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'all', label: t('leaveRequests.tabAll') },
    { key: 'approved', label: t('leaveRequests.status.approved') },
    { key: 'rejected', label: t('leaveRequests.status.rejected') },
    { key: 'pending', label: t('leaveRequests.status.pending') },
  ]

  const seqRef = useRef(0)

  // 抽成具名函数是为了给失败态的「重试」一个入口——原来它写死在 effect 的 IIFE 里，
  // 加载失败后除了退出重进页面别无他法（这正是四个页面里最像 bug 的那一处）
  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    const seq = ++seqRef.current
    const { data, error } = await supabase
      .from('leave_requests')
      .select('*, rehearsals(type, start_time, end_time)')
      .order('created_at', { ascending: false })
    if (seq !== seqRef.current) return
    setLoading(false)
    if (error) {
      setFailed(true)
      return
    }
    setRequests((data as LeaveRequestWithRehearsal[]) ?? [])
  }, [])

  /**
   * 考勤类通知（考勤状态被管理员改、考勤修改申请被通过/驳回）。
   *
   * ⚠️ 这些通知以前只用来点红点：页面把它们全部标已读，却一条都不渲染，于是用户
   * 「点进来红点没了、但什么也没看到」，而底下的考勤页仍是旧状态（Otto 2026-10-22
   * 反馈的就是这条路径）。现在先把内容展示出来，再标已读。
   */
  const loadNotices = useCallback(async () => {
    const { rows, error } = await fetchByCategory('attendance')
    // 失败时保留上一次的列表：用户主动打开页面时不该因为一次网络抖动就清空通知
    if (error) return
    setAttendanceNotices(rows)
    const unread = rows.filter((r) => r.read_at === null).map((r) => r.id)
    if (unread.length > 0) {
      const ok = await markCategoryRead('attendance', unread)
      if (ok) notifyNotificationsUpdated()
    }
  }, [fetchByCategory, markCategoryRead])

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('leaveRequests.navTitle') })
    void load()
    void loadNotices()
    // 不带卸载守卫：原 mounted 标志只为避免卸载后 setState（React 18 下是无害 no-op），
    // 而「慢的旧响应盖掉新响应」由 load 里的 seq 比对兜住——重试与切语言都走那条
  }, [load, loadNotices, t])

  // 从别的页面返回时两条数据都可能变了：请假状态被审批 / 考勤通知新到。首帧由上面的
  // effect 拉，这里只处理「再次显示」，避免重复请求。
  const firstShowRef = useRef(true)
  useDidShow(() => {
    if (firstShowRef.current) {
      firstShowRef.current = false
      return
    }
    void load()
    void loadNotices()
  })

  const filtered = useMemo(
    () => (tab === 'all' ? requests : requests.filter((r) => r.status === tab)),
    [requests, tab]
  )

  return (
    <View className={`${darkClass} flex h-full flex-col bg-page-bg`}>
      {/* 顶部 tab 过滤（主色中字，切换即过滤） */}
      <SegmentTabs tabs={tabs} value={tab} onChange={(k) => setTab(k)} />

      <ScrollView scrollY className='flex-1 min-h-0'>
        <View className='px-4 pb-safe pt-1'>
          {attendanceNotices.length > 0 && (
            <View className='mb-3'>
              <Text className='mb-2 block text-xs font-medium uppercase tracking-wide text-text-muted'>
                {t('leaveRequests.attendanceNoticesTitle')}
              </Text>
              {attendanceNotices.map((notice) => {
                // 现有通知里只有部分带排练 id（考勤修改申请那类只带 request_id）；
                // 能定位到排练的才给跳转，别让整张卡看起来可点却什么都没发生。
                const meta = notice.meta as { rehearsal_id?: unknown } | null
                const rehearsalId =
                  typeof meta?.rehearsal_id === 'number' ? meta.rehearsal_id : null
                return (
                  <View
                    key={notice.id}
                    className='mb-2 rounded-xl border border-border bg-card px-3 py-2'
                    onClick={
                      rehearsalId
                        ? () =>
                            void Taro.navigateTo({
                              url: `/pages/rehearsal-detail/index?id=${rehearsalId}`,
                            })
                        : undefined
                    }
                  >
                    <Text className='block text-sm font-medium text-text'>{notice.title}</Text>
                    <Text className='mt-1 block whitespace-pre-wrap text-xs text-text-muted'>
                      {notice.content}
                    </Text>
                    <Text className='mt-1 block text-[10px] text-text-muted'>
                      {formatDateTimeInChina(notice.created_at)}
                    </Text>
                  </View>
                )
              })}
            </View>
          )}
          {/* loadingOnlyWhenEmpty=false：切 tab 只是本地过滤、不会重新加载，但首次加载失败后
              重试时 loading 必须先于 failed 生效，否则按钮按下去没反应 */}
          <ListState
            loading={loading}
            loadingOnlyWhenEmpty={false}
            error={failed ? t('leaveRequests.loadFailed') : null}
            isEmpty={filtered.length === 0}
            emptyText={t('leaveRequests.empty')}
            onRetry={() => void load()}
          >
            {filtered.map((r) => {
              const rehearsal = r.rehearsals
              const timeText = rehearsal?.start_time
                ? formatRehearsalRange(rehearsal.start_time, rehearsal.end_time ?? null)
                : t('leaveRequests.timeUnset')
              const typeText = rehearsalTypeLabel(rehearsal?.type ?? null)
              return (
                <View key={r.id} className='mb-3 rounded-xl border border-border bg-card p-4'>
                  {/* 排练时间（中大字） */}
                  <Text className='block text-lg font-semibold text-primary'>{timeText}</Text>
                  {/* 排练类型：副色标签 + 主色值（下同） */}
                  <View className='mt-2'>
                    <Text className='text-sm text-text-muted'>{t('leaveRequests.labelType')}</Text>
                    <Text className='text-sm text-primary'>{typeText}</Text>
                  </View>
                  <View className='mt-1'>
                    <Text className='text-sm text-text-muted'>
                      {t('leaveRequests.labelReason')}
                    </Text>
                    <Text className='whitespace-pre-wrap text-sm text-primary'>{r.reason}</Text>
                  </View>
                  <View className='mt-1'>
                    <Text className='text-sm text-text-muted'>
                      {t('leaveRequests.labelReviewReason')}
                    </Text>
                    <Text className='whitespace-pre-wrap text-sm text-primary'>
                      {r.reject_reason || '—'}
                    </Text>
                  </View>
                  {/* 状态：右下角彩色方框 */}
                  <View className='mt-3 flex justify-end'>
                    <StatusChip tone={STATUS_TONE[r.status]}>{statusLabels[r.status]}</StatusChip>
                  </View>
                </View>
              )
            })}
          </ListState>
        </View>
      </ScrollView>
    </View>
  )
}
