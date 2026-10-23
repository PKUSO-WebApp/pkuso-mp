import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import { supabase } from '@/lib/supabase'
import { ListState } from '@/components/ui/ListState'
import { StatusChip, type StatusTone } from '@/components/ui/StatusChip'
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

/**
 * 声部请假：数据只来自 `get_section_leave_requests`（SECURITY DEFINER），
 * **不返回理由/附件**；默认仅未取消，切换后含 canceled/withdrawn。
 * 排练筛选在本地做（列表量级小），数据源仍是一次 RPC。
 */
export default function SectionLeavePage() {
  const { t } = useT()
  useNavTitle('sectionLeave.navTitle')
  const darkClass = useThemeClass()

  const [includeCanceled, setIncludeCanceled] = useState(false)
  const [selectedRehearsal, setSelectedRehearsal] = useState<number | 'all'>('all')
  const [rows, setRows] = useState<SectionLeaveRow[]>([])
  const [profiles, setProfiles] = useState<Map<string, ProfileMini>>(new Map())
  const [rehearsals, setRehearsals] = useState<Map<number, RehearsalMini>>(new Map())
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

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

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    const { data, error } = await supabase.rpc('get_section_leave_requests', {
      p_rehearsal_id: undefined,
      p_include_canceled: includeCanceled,
    })
    if (error) {
      setLoading(false)
      setFailed(true)
      return
    }

    const list = (data as SectionLeaveRow[] | null) ?? []
    setRows(list)

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
      setLoading(false)
      setFailed(true)
      return
    }

    setProfiles(new Map(((profileRes.data as ProfileMini[] | null) ?? []).map((p) => [p.id, p])))
    setRehearsals(
      new Map(((rehearsalRes.data as RehearsalMini[] | null) ?? []).map((r) => [r.id, r]))
    )
    setLoading(false)
  }, [includeCanceled])

  useEffect(() => {
    void load()
  }, [load])

  const rehearsalOptions = useMemo(() => {
    const ids = [...new Set(rows.map((r) => r.rehearsal_id))]
    return ids
      .map((id) => rehearsals.get(id))
      .filter((r): r is RehearsalMini => !!r)
      .sort((a, b) => (b.start_time ?? '').localeCompare(a.start_time ?? ''))
  }, [rehearsals, rows])

  const filtered = useMemo(
    () =>
      selectedRehearsal === 'all' ? rows : rows.filter((r) => r.rehearsal_id === selectedRehearsal),
    [rows, selectedRehearsal]
  )

  return (
    <View className={`${darkClass} flex h-full flex-col bg-page-bg`}>
      <View className='px-4 py-3'>
        <View
          className='self-start rounded-full border border-border bg-muted px-3 py-1'
          onClick={() => setIncludeCanceled((v) => !v)}
        >
          <Text className='text-xs text-primary'>
            {includeCanceled ? t('sectionLeave.onlyActive') : t('sectionLeave.includeCanceled')}
          </Text>
        </View>
      </View>

      <ScrollView scrollX className='px-4'>
        <View className='inline-flex flex-row gap-1.5 pb-2'>
          <View
            className={`rounded-full border px-3 py-1 ${
              selectedRehearsal === 'all' ? 'border-primary bg-primary' : 'border-border bg-card'
            }`}
            onClick={() => setSelectedRehearsal('all')}
          >
            <Text
              className={`text-xs ${
                selectedRehearsal === 'all' ? 'text-primary-foreground' : 'text-text'
              }`}
            >
              {t('sectionLeave.allRehearsals')}
            </Text>
          </View>
          {rehearsalOptions.map((rehearsal) => {
            const active = selectedRehearsal === rehearsal.id
            return (
              <View
                key={rehearsal.id}
                className={`rounded-full border px-3 py-1 ${
                  active ? 'border-primary bg-primary' : 'border-border bg-card'
                }`}
                onClick={() => setSelectedRehearsal(rehearsal.id)}
              >
                <Text className={`text-xs ${active ? 'text-primary-foreground' : 'text-text'}`}>
                  {rehearsal.start_time
                    ? formatRehearsalRange(rehearsal.start_time, rehearsal.end_time ?? null)
                    : t('sectionLeave.timeUnset')}
                </Text>
              </View>
            )
          })}
        </View>
      </ScrollView>

      <ScrollView scrollY className='flex-1 min-h-0'>
        <View className='px-4 pb-6 pt-1'>
          <ListState
            loading={loading}
            error={failed ? t('sectionLeave.loadFailed') : null}
            isEmpty={filtered.length === 0}
            emptyText={t('sectionLeave.empty')}
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
                  {rehearsal?.repertoire && (
                    <Text className='mt-1 block text-xs text-text-muted'>
                      {rehearsal.repertoire}
                    </Text>
                  )}
                  <Text className='mt-1 block text-xs text-text-muted'>
                    {row.created_at.slice(0, 16).replace('T', ' ')}
                  </Text>
                </View>
              )
            })}
          </ListState>
        </View>
      </ScrollView>
    </View>
  )
}
