import { useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { useNotifications } from '@/hooks/useNotifications'
import { notifyNotificationsUpdated } from '@/components/notification-badge-sync'
import { SegmentTabs } from '@/components/ui/SegmentTabs'
import { formatRehearsalRange } from '@/lib/date-utils'
import type { LeaveRequestRow, LeaveStatus } from '@/types/database'

type RehearsalMini = {
  type: string | null
  start_time: string | null
  end_time: string | null
}
type LeaveRequestWithRehearsal = LeaveRequestRow & { rehearsals: RehearsalMini | null }

const STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: '待审批',
  approved: '已通过',
  rejected: '已驳回',
  withdrawn: '已撤回',
  canceled: '已取消',
}

const STATUS_CLASS: Record<LeaveStatus, string> = {
  approved: 'bg-success-bg text-success',
  rejected: 'bg-danger-bg text-danger',
  pending: 'bg-warning-bg text-warning',
  withdrawn: 'bg-muted text-text-muted',
  canceled: 'bg-muted text-text-muted',
}

type TabKey = 'all' | 'approved' | 'rejected' | 'pending'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已驳回' },
  { key: 'pending', label: '待审批' },
]

// 与排练卡片一致：section → 分排，其余 → 合排
const rehearsalTypeLabel = (type: string | null): string =>
  type === 'section' ? '分排' : type === 'full' ? '合排' : type || '排练'

export default function LeaveRequestsPage() {
  const [tab, setTab] = useState<TabKey>('all')
  const [requests, setRequests] = useState<LeaveRequestWithRehearsal[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const { fetchByCategory, markCategoryRead } = useNotifications()

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: '我的请假' })
    let mounted = true
    void (async () => {
      const { data, error } = await supabase
        .from('leave_requests')
        .select('*, rehearsals(type, start_time, end_time)')
        .order('created_at', { ascending: false })
      if (!mounted) return
      if (error) {
        setFailed(true)
        setLoading(false)
        return
      }
      setRequests((data as LeaveRequestWithRehearsal[]) ?? [])
      setLoading(false)
    })()
    // 进入即视为已读「考勤与请假」通知（替代原 Modal 的标已读逻辑），清红点
    void (async () => {
      const { rows } = await fetchByCategory('attendance')
      const unread = rows.filter((r) => r.read_at === null).map((r) => r.id)
      if (unread.length > 0) {
        const ok = await markCategoryRead('attendance', unread)
        if (ok) notifyNotificationsUpdated()
      }
    })()
    return () => {
      mounted = false
    }
  }, [fetchByCategory, markCategoryRead])

  const filtered = useMemo(
    () => (tab === 'all' ? requests : requests.filter((r) => r.status === tab)),
    [requests, tab]
  )

  return (
    <View className='flex h-full flex-col bg-page-bg'>
      {/* 顶部 tab 过滤（主色中字，切换即过滤） */}
      <SegmentTabs tabs={TABS} value={tab} onChange={(k) => setTab(k)} />

      <ScrollView scrollY className='flex-1 min-h-0'>
        <View className='px-4 pb-safe pt-1'>
          {loading ? (
            <Text className='block py-10 text-center text-xs text-text-muted'>加载中…</Text>
          ) : failed ? (
            <Text className='block py-10 text-center text-sm text-text-muted'>加载失败，请稍后重试</Text>
          ) : filtered.length === 0 ? (
            <Text className='block py-10 text-center text-sm text-text-muted'>暂无请假记录</Text>
          ) : (
            filtered.map((r) => {
              const rehearsal = r.rehearsals
              const timeText = rehearsal?.start_time
                ? formatRehearsalRange(rehearsal.start_time, rehearsal.end_time ?? null)
                : '时间未设置'
              const typeText = rehearsalTypeLabel(rehearsal?.type ?? null)
              return (
                <View key={r.id} className='mb-3 rounded-xl border border-border bg-card p-4'>
                  {/* 排练时间（中大字） */}
                  <Text className='block text-lg font-semibold text-primary'>{timeText}</Text>
                  {/* 排练类型：副色标签 + 主色值（下同） */}
                  <View className='mt-2'>
                    <Text className='text-sm text-text-muted'>排练类型：</Text>
                    <Text className='text-sm text-primary'>{typeText}</Text>
                  </View>
                  <View className='mt-1'>
                    <Text className='text-sm text-text-muted'>请假理由：</Text>
                    <Text className='whitespace-pre-wrap text-sm text-primary'>{r.reason}</Text>
                  </View>
                  <View className='mt-1'>
                    <Text className='text-sm text-text-muted'>审批理由：</Text>
                    <Text className='whitespace-pre-wrap text-sm text-primary'>{r.reject_reason || '—'}</Text>
                  </View>
                  {/* 状态：右下角彩色方框 */}
                  <View className='mt-3 flex justify-end'>
                    <Text
                      className={`inline-flex items-center rounded px-2 py-1 text-xs ${STATUS_CLASS[r.status]}`}
                    >
                      {STATUS_LABEL[r.status]}
                    </Text>
                  </View>
                </View>
              )
            })
          )}
        </View>
      </ScrollView>
    </View>
  )
}
