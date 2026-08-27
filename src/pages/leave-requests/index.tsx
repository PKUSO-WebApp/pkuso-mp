import { useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { useNotifications } from '@/hooks/useNotifications'
import { notifyNotificationsUpdated } from '@/components/notification-badge-sync'
import { SegmentTabs } from '@/components/ui/SegmentTabs'
import { StatusChip, type StatusTone } from '@/components/ui/StatusChip'
import { formatRehearsalRange } from '@/lib/date-utils'
import { useT } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import type { LeaveRequestRow, LeaveStatus } from '@/types/database'

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
  const darkClass = useThemeClass()
  const [tab, setTab] = useState<TabKey>('all')
  const [requests, setRequests] = useState<LeaveRequestWithRehearsal[]>([])
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

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('leaveRequests.navTitle') })
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
  }, [fetchByCategory, markCategoryRead, t])

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
          {loading ? (
            <Text className='block py-10 text-center text-xs text-text-muted'>{t('common.actions.loading')}</Text>
          ) : failed ? (
            <Text className='block py-10 text-center text-sm text-text-muted'>{t('leaveRequests.loadFailed')}</Text>
          ) : filtered.length === 0 ? (
            <Text className='block py-10 text-center text-sm text-text-muted'>{t('leaveRequests.empty')}</Text>
          ) : (
            filtered.map((r) => {
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
                    <Text className='text-sm text-text-muted'>{t('leaveRequests.labelReason')}</Text>
                    <Text className='whitespace-pre-wrap text-sm text-primary'>{r.reason}</Text>
                  </View>
                  <View className='mt-1'>
                    <Text className='text-sm text-text-muted'>{t('leaveRequests.labelReviewReason')}</Text>
                    <Text className='whitespace-pre-wrap text-sm text-primary'>{r.reject_reason || '—'}</Text>
                  </View>
                  {/* 状态：右下角彩色方框 */}
                  <View className='mt-3 flex justify-end'>
                    <StatusChip tone={STATUS_TONE[r.status]}>{statusLabels[r.status]}</StatusChip>
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
