import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import { useDidHide, useDidShow } from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { DATA_SYNC_INTERVAL_MS, subscribeSync } from '@/lib/dataSync'
import { ListState } from '@/components/ui/ListState'
import { Modal } from '@/components/ui/Modal'
import { StatusChip, type StatusTone } from '@/components/ui/StatusChip'
import { useNotifications } from '@/hooks/useNotifications'
import { notifyNotificationsUpdated } from '@/components/notification-badge-sync'
import { formatRehearsalRange } from '@/lib/date-utils'
import { translateInstrument } from '@/lib/instrument-i18n'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import type { LeaveStatus } from '@/types/database'
import './index.scss'

type SectionLeaveRow = {
  request_id: string
  user_id: string
  rehearsal_id: number
  status: LeaveStatus
  created_at: string
}

type ProfileMini = { id: string; full_name: string | null; instrument: string | null }
type RehearsalMini = {
  id: number
  type: string | null
  start_time: string | null
  end_time: string | null
  repertoire: string | null
}

const STATUS_TONE: Record<LeaveStatus, StatusTone> = {
  approved: 'success',
  rejected: 'danger',
  pending: 'warning',
  withdrawn: 'neutral',
  canceled: 'neutral',
}

/** 默认视图排除的终态（与 get_section_leave_requests 的 p_include_canceled=false 同口径） */
const HIDDEN_BY_DEFAULT = new Set<LeaveStatus>(['canceled', 'withdrawn'])

/**
 * 声部请假：数据只来自 `get_section_leave_requests`（SECURITY DEFINER），
 * **不返回理由/附件**。一次拉**全量**（含 canceled/withdrawn），「显示取消的请求」
 * 开关只做本地过滤 —— 切换时不再重新请求 RPC / 成员 / 排练（时间不会重新加载）。
 * 排练筛选也在本地做；列表量级小。
 */
export default function SectionLeavePage() {
  const { t } = useT()
  useNavTitle('sectionLeave.navTitle')
  const darkClass = useThemeClass()

  const [includeCanceled, setIncludeCanceled] = useState(false)
  const [selectedRehearsal, setSelectedRehearsal] = useState<number | 'all'>('all')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [allRows, setAllRows] = useState<SectionLeaveRow[]>([])
  const [profiles, setProfiles] = useState<Map<string, ProfileMini>>(new Map())
  const [rehearsals, setRehearsals] = useState<Map<number, RehearsalMini>>(new Map())
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const { fetchByCategory, markCategoryRead } = useNotifications()

  const statusLabels: Record<LeaveStatus, string> = {
    pending: t('leaveRequests.status.pending'),
    approved: t('leaveRequests.status.approved'),
    rejected: t('leaveRequests.status.rejected'),
    withdrawn: t('leaveRequests.status.withdrawn'),
    canceled: t('leaveRequests.status.canceled'),
  }

  const rehearsalTypeLabel = (type: string | null): string =>
    type === 'section'
      ? t('sectionLeave.type.section')
      : type === 'full'
        ? t('sectionLeave.type.full')
        : t('sectionLeave.type.rehearsal')

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!silent) {
      setLoading(true)
      setFailed(false)
    }
    // 始终拉全量：开关只做本地过滤，避免每次切换都重新请求（时间也会重新拉）
    const { data, error } = await supabase.rpc('get_section_leave_requests', {
      p_rehearsal_id: undefined,
      p_include_canceled: true,
    })
    if (error) {
      if (!silent) {
        setLoading(false)
        setFailed(true)
      }
      return
    }

    const list = (data as SectionLeaveRow[] | null) ?? []
    setAllRows(list)

    const userIds = [...new Set(list.map((r) => r.user_id))]
    const rehearsalIds = [...new Set(list.map((r) => r.rehearsal_id))]

    const [profileRes, rehearsalRes] = await Promise.all([
      userIds.length > 0
        ? supabase.from('profiles_roster').select('id, full_name, instrument').in('id', userIds)
        : Promise.resolve({ data: [] as ProfileMini[], error: null }),
      rehearsalIds.length > 0
        ? supabase
            .from('rehearsals')
            .select('id, type, start_time, end_time, repertoire')
            .in('id', rehearsalIds)
        : Promise.resolve({ data: [] as RehearsalMini[], error: null }),
    ])

    if (profileRes.error || rehearsalRes.error) {
      if (!silent) {
        setLoading(false)
        setFailed(true)
      }
      return
    }

    setProfiles(new Map(((profileRes.data as ProfileMini[] | null) ?? []).map((p) => [p.id, p])))
    setRehearsals(
      new Map(((rehearsalRes.data as RehearsalMini[] | null) ?? []).map((r) => [r.id, r]))
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 成员在**别的设备**取消请假时，本页不会收到任何本地事件：靠 30s 心跳静默重拉。
  // （`check_data_versions.leave` 只含调用者自己可见的行，声部长看不到成员的请假行，
  //   所以不能只依赖 dataSync 的 leave 事件；通知未读数变了时才额外广播 notifications。）
  const [pageActive, setPageActive] = useState(true)
  useDidShow(() => {
    setPageActive(true)
    void load({ silent: true })
  })
  useDidHide(() => {
    setPageActive(false)
  })
  useEffect(() => {
    if (!pageActive) return
    const timer = setInterval(() => void load({ silent: true }), DATA_SYNC_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [load, pageActive])
  useEffect(() => subscribeSync('notifications', () => void load({ silent: true })), [load])
  useEffect(() => subscribeSync('leave', () => void load({ silent: true })), [load])

  // 打开即把「声部请假」通知标为已读（与其他信箱同一语义）；只标本页打开时已有的 id，
  // 打开瞬间新到的通知不会被无界更新误标。
  useEffect(() => {
    void (async () => {
      const { rows: notifRows } = await fetchByCategory('section_leave')
      const unread = notifRows.filter((r) => r.read_at === null).map((r) => r.id)
      if (unread.length === 0) return
      const ok = await markCategoryRead('section_leave', unread)
      if (ok) notifyNotificationsUpdated()
    })()
  }, [fetchByCategory, markCategoryRead])

  // 本地过滤：数据只拉一次；开关切换不重新请求，也不重置时间
  const visibleRows = useMemo(
    () => (includeCanceled ? allRows : allRows.filter((r) => !HIDDEN_BY_DEFAULT.has(r.status))),
    [allRows, includeCanceled]
  )

  // 切换后原先选中的排练可能只剩被隐藏的取消记录 ⇒ 回到「全部」
  useEffect(() => {
    setSelectedRehearsal((prev) =>
      prev === 'all' || visibleRows.some((r) => r.rehearsal_id === prev) ? prev : 'all'
    )
  }, [visibleRows])

  const rehearsalOptions = useMemo(() => {
    const ids = [...new Set(visibleRows.map((r) => r.rehearsal_id))]
    return ids
      .map((id) => rehearsals.get(id))
      .filter((r): r is RehearsalMini => !!r)
      .sort((a, b) => (b.start_time ?? '').localeCompare(a.start_time ?? ''))
  }, [rehearsals, visibleRows])

  const rehearsalCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const row of visibleRows) {
      counts.set(row.rehearsal_id, (counts.get(row.rehearsal_id) ?? 0) + 1)
    }
    return counts
  }, [visibleRows])

  const filtered = useMemo(
    () =>
      selectedRehearsal === 'all'
        ? visibleRows
        : visibleRows.filter((r) => r.rehearsal_id === selectedRehearsal),
    [visibleRows, selectedRehearsal]
  )

  const selectedRehearsalInfo =
    selectedRehearsal === 'all' ? null : rehearsals.get(selectedRehearsal)
  const selectedLabel =
    selectedRehearsal === 'all'
      ? t('sectionLeave.allRehearsals')
      : selectedRehearsalInfo?.start_time
        ? formatRehearsalRange(
            selectedRehearsalInfo.start_time,
            selectedRehearsalInfo.end_time ?? null
          )
        : t('sectionLeave.timeUnset')

  return (
    <View className={`${darkClass} flex h-full flex-col bg-page-bg`}>
      {/* 筛选栏：左侧点开排练列表（可滚动，带条数），右侧「显示取消」开关。
          开关文字恒定，开/关由轨道颜色和滑块位置表达——不再用会随点击翻转的
          动作式文案，避免「标签说的和当前列表相反」。 */}
      <View className='flex items-center justify-between gap-2 px-4 py-3'>
        <View
          className='flex min-w-0 flex-1 items-center gap-1'
          onClick={() => setPickerOpen(true)}
        >
          <Text className='overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-text'>
            {selectedLabel}
          </Text>
          <Text className='shrink-0 text-xs text-text-muted'>▾</Text>
        </View>
        <View
          className='flex shrink-0 items-center gap-1.5'
          onClick={() => setIncludeCanceled((v) => !v)}
        >
          <Text className={`text-xs ${includeCanceled ? 'text-text' : 'text-text-muted'}`}>
            {t('sectionLeave.showCanceled')}
          </Text>
          <View
            className={`flex h-5 w-9 items-center rounded-full p-0.5 ${
              includeCanceled ? 'bg-primary' : 'bg-border'
            }`}
          >
            <View
              className={`h-4 w-4 rounded-full bg-card shadow ${includeCanceled ? 'ml-auto' : ''}`}
            />
          </View>
        </View>
      </View>

      <ScrollView scrollY className='flex-1 min-h-0'>
        <View className='px-4 pb-6 pt-1'>
          <ListState
            loading={loading}
            error={failed ? t('sectionLeave.loadFailed') : null}
            isEmpty={filtered.length === 0}
            emptyText={includeCanceled ? t('sectionLeave.empty') : t('sectionLeave.emptyActive')}
            onRetry={() => void load()}
          >
            {filtered.map((row) => {
              const profile = profiles.get(row.user_id)
              const rehearsal = rehearsals.get(row.rehearsal_id)
              return (
                <View
                  key={row.request_id}
                  className='mb-3 rounded-xl border border-border bg-card p-4'
                >
                  <View className='flex items-center justify-between'>
                    <Text className='text-base font-semibold text-text'>
                      {profile?.full_name || t('sectionLeave.memberUnknown')}
                    </Text>
                    <StatusChip tone={STATUS_TONE[row.status]}>
                      {statusLabels[row.status]}
                    </StatusChip>
                  </View>
                  <View className='mt-1 flex flex-wrap items-center gap-1.5'>
                    <Text className='text-xs text-text-muted'>
                      {translateInstrument(profile?.instrument ?? '', t) || '—'}
                    </Text>
                    <Text className='text-xs text-text-muted'>
                      ·{' '}
                      {rehearsal?.start_time
                        ? formatRehearsalRange(rehearsal.start_time, rehearsal.end_time ?? null)
                        : t('sectionLeave.timeUnset')}
                    </Text>
                    <Text className='text-xs text-text-muted'>
                      · {rehearsalTypeLabel(rehearsal?.type ?? null)}
                    </Text>
                  </View>
                  <Text className='mt-1 block text-xs text-text-muted'>
                    {row.created_at.slice(0, 16).replace('T', ' ')}
                  </Text>
                </View>
              )
            })}
          </ListState>
        </View>
      </ScrollView>

      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t('sectionLeave.filterTitle')}
      >
        <View>
          <View
            className={`flex items-center justify-between rounded-xl px-3 py-3 ${
              selectedRehearsal === 'all' ? 'bg-muted' : ''
            }`}
            onClick={() => {
              setSelectedRehearsal('all')
              setPickerOpen(false)
            }}
          >
            <Text
              className={`text-sm ${
                selectedRehearsal === 'all' ? 'font-medium text-primary' : 'text-text'
              }`}
            >
              {t('sectionLeave.allRehearsals')}
            </Text>
            <Text className='text-xs text-text-muted'>{visibleRows.length}</Text>
          </View>

          {rehearsalOptions.map((rehearsal) => {
            const active = selectedRehearsal === rehearsal.id
            const timeText = rehearsal.start_time
              ? formatRehearsalRange(rehearsal.start_time, rehearsal.end_time ?? null)
              : t('sectionLeave.timeUnset')
            return (
              <View
                key={rehearsal.id}
                className={`flex items-center rounded-xl px-3 py-3 ${active ? 'bg-muted' : ''}`}
                onClick={() => {
                  setSelectedRehearsal(rehearsal.id)
                  setPickerOpen(false)
                }}
              >
                <View className='min-w-0 flex-1'>
                  <Text
                    className={`block overflow-hidden text-ellipsis whitespace-nowrap text-sm ${
                      active ? 'font-medium text-primary' : 'text-text'
                    }`}
                  >
                    {timeText}
                  </Text>
                  <Text className='mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-text-muted'>
                    {rehearsalTypeLabel(rehearsal.type)}
                    {rehearsal.repertoire ? ` · ${rehearsal.repertoire}` : ''}
                  </Text>
                </View>
                <Text className='ml-2 shrink-0 text-xs text-text-muted'>
                  {rehearsalCounts.get(rehearsal.id) ?? 0}
                </Text>
                {active && <Text className='ml-2 shrink-0 text-xs text-primary'>✓</Text>}
              </View>
            )
          })}

          {rehearsalOptions.length === 0 && (
            <Text className='block py-8 text-center text-xs text-text-muted'>
              {t('sectionLeave.empty')}
            </Text>
          )}
        </View>
      </Modal>
    </View>
  )
}
