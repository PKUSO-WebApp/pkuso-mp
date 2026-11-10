import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { pinyinSortKey } from '@/lib/pinyin-sort'
import type { AttendanceRowWithUser } from '@/types/database'

export type RehearsalAttendanceRow = AttendanceRowWithUser & {
  profiles?: { full_name?: string | null; instrument?: string | null } | null
}

function compareRows(a: RehearsalAttendanceRow, b: RehearsalAttendanceRow): number {
  const an = (a.profiles?.full_name ?? '').trim()
  const bn = (b.profiles?.full_name ?? '').trim()
  const ka = pinyinSortKey(an)
  const kb = pinyinSortKey(bn)
  if (ka !== kb) return ka < kb ? -1 : 1
  if (an !== bn) return an < bn ? -1 : 1
  return a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0
}

/**
 * 某场排练的考勤名单（含姓名 / 声部）。
 *
 * `attendances` 有两条指向 profiles 的 FK（user_id / updated_by），PostgREST 无法
 * 自动选路——必须显式指定 user_id 那条（与 web 的 useAttendance 同一条）。
 */
export function useRehearsalAttendance(rehearsalId: number | null) {
  const [rows, setRows] = useState<RehearsalAttendanceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const seqRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const fetchRows = useCallback(async (id: number) => {
    const seq = ++seqRef.current
    setLoading(true)
    setFailed(false)
    const { data, error } = await supabase
      .from('attendances')
      .select('*, profiles!attendances_user_id_profiles_fkey(full_name, instrument)')
      .eq('rehearsal_id', id)
    if (!mountedRef.current || seq !== seqRef.current) return
    setLoading(false)
    if (error) {
      console.error('[useRehearsalAttendance] 名单加载失败', error)
      setFailed(true)
      setRows([])
      return
    }
    const list = ((data ?? []) as unknown as RehearsalAttendanceRow[]).slice()
    list.sort(compareRows)
    setRows(list)
  }, [])

  useEffect(() => {
    if (!rehearsalId) {
      seqRef.current += 1
      setRows([])
      setLoading(false)
      setFailed(false)
      return
    }
    void fetchRows(rehearsalId)
  }, [fetchRows, rehearsalId])

  const reload = useCallback(async () => {
    if (!rehearsalId) return
    await fetchRows(rehearsalId)
  }, [fetchRows, rehearsalId])

  return { rows, loading, failed, reload }
}
