import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
import { parseLocalISO, getLocalDateString } from '@/lib/date-utils'
import type { AttendanceRow, AttendanceRowWithUser, AttendanceStatus } from '@/types/database'

export type AttendanceEntry = {
  rehearsal_id: number
  user_id: string
  status: 'present' | 'late' | 'absent' | 'excused'
  sign_in_time?: string | null
}

export type AttendanceSignInInput = {
  rehearsal_id: number
  code: string
}

/** sign_in_attendance RPC 返回行（服务端生成 status/sign_in_time） */
export type SignInResultRow = {
  id: number
  rehearsal_id: number
  user_id: string
  status: AttendanceStatus
  sign_in_time: string | null
}

/** 签到结果：error 非空为失败（中文归一化由调用方负责）；成功时 row 为服务端返回行 */
export type SignInResult = { error: string | null; row: SignInResultRow | null }

/** 考勤历史查询过滤：两端都空查全部；只填一端按该端开放过滤 */
export type AttendanceHistoryFilter = {
  startDate?: string
  endDate?: string
}

/** 考勤 join 排练的返回行（仅取展示所需排练列，不含 profiles 敏感列） */
export type AttendanceHistoryRow = AttendanceRow & {
  rehearsals?: {
    start_time?: string | null
    end_time?: string | null
    location?: string | null
    repertoire?: string | null
  } | null
}

/** 考勤历史查询结果：error 非空为失败（rows 为空数组） */
export type AttendanceHistoryResult = { rows: AttendanceHistoryRow[]; error: string | null }

/** 日期字符串的次日（YYYY-MM-DD）：区间上界用开区间（< 次日），
 *  结束当天 23:59 开始的排练也算在区间内 */
const nextDayString = (dateStr: string): string => {
  const d = parseLocalISO(dateStr)
  d.setDate(d.getDate() + 1)
  return getLocalDateString(d)
}

const SECURE_ATTENDANCE_RPC_REQUIRED = '该操作需要服务端安全权限，当前暂不可用'

export type MyAttendanceMap = Record<number, { status: string; sign_in_time: string | null }>

export function useAttendance(client: typeof defaultClient = defaultClient) {
  const [map, setMap] = useState<MyAttendanceMap>({})
  const [list] = useState<AttendanceRowWithUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const mountedRef = useRef(true)
  const savingRef = useRef(false)
  const updateRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  /** 查询当前用户指定排练的考勤记录（RLS 允许 SELECT 自己的行）。 */
  const fetchMyAttendances = useCallback(
    async (userId: string, rehearsalIds: number[]) => {
      if (!mountedRef.current) return
      if (!rehearsalIds.length) {
        setMap({})
        setLoading(false)
        return
      }
      setLoading(true)
      const { data: rows, error: dbError } = await client
        .from('attendances')
        .select('rehearsal_id, status, sign_in_time')
        .eq('user_id', userId)
        .in('rehearsal_id', rehearsalIds)
      if (!mountedRef.current) return
      setLoading(false)
      if (dbError) {
        setError('考勤数据加载失败')
        return
      }
      const newMap: MyAttendanceMap = {}
      for (const row of (rows ?? []) as {
        rehearsal_id: number
        status: string
        sign_in_time: string | null
      }[]) {
        newMap[row.rehearsal_id] = { status: row.status, sign_in_time: row.sign_in_time }
      }
      setMap(newMap)
      setError(null)
    },
    [client]
  )

  /** 查询指定排练的考勤列表（RLS 允许 SELECT 自己的行）。 */
  const fetchByRehearsal = useCallback(
    async (rehearsalId: number) => {
      if (!mountedRef.current) return []
      const { data: rows, error: dbError } = await client
        .from('attendances')
        .select('*')
        .eq('rehearsal_id', rehearsalId)
      if (dbError) {
        if (mountedRef.current) setError(dbError.message)
        return []
      }
      return (rows as AttendanceRowWithUser[]) ?? []
    },
    [client]
  )

  const upsert = useCallback(async (rows: AttendanceEntry[]) => {
    // 禁止客户端直接写入 user_id/status/sign_in_time；这些字段必须由安全 RPC
    // 根据 auth.uid、签到码和数据库时间窗口原子生成。
    void rows
    return SECURE_ATTENDANCE_RPC_REQUIRED
  }, [])

  /** 安全签到：仅通过 sign_in_attendance SECURITY DEFINER RPC 写入，
   *  客户端不传 user_id/status/sign_in_time。 */
  const signIn = useCallback(
    async (input: AttendanceSignInInput): Promise<SignInResult> => {
      if (savingRef.current) return { error: '请勿重复提交', row: null }
      savingRef.current = true
      setSaving(true)
      setError(null)
      try {
        const { data, error: dbError } = await client.rpc('sign_in_attendance', {
          p_rehearsal_id: input.rehearsal_id,
          p_code: input.code,
        })
        if (dbError) {
          setError(dbError.message)
          return { error: dbError.message, row: null }
        }
        const rows = (data ?? []) as SignInResultRow[]
        return { error: null, row: rows[0] ?? null }
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    },
    [client]
  )

  const updateStatus = useCallback(
    async (rehearsalId: number, userId: string, status: AttendanceStatus) => {
      void rehearsalId
      void userId
      void status
      if (saving || updateRef.current) return '请勿重复提交'
      if (mountedRef.current) setError(SECURE_ATTENDANCE_RPC_REQUIRED)
      return SECURE_ATTENDANCE_RPC_REQUIRED
    },
    [saving]
  )

  const batchInsert = useCallback(async (rows: AttendanceEntry[]) => {
    void rows
    return SECURE_ATTENDANCE_RPC_REQUIRED
  }, [])

  const fetchStats = useCallback(async (rehearsalIds: (string | number)[]) => {
    void rehearsalIds
    if (mountedRef.current) setError(SECURE_ATTENDANCE_RPC_REQUIRED)
    return []
  }, [])

  /**
   * 查询本人考勤历史（join 排练展示信息，按起止日期过滤，按排练开始时间倒序）。
   * 两端都空查全部；只填一端按该端开放过滤（另一端不设界）；
   * 结束日期上界取次日开区间（< 次日），结束当天深夜开始的排练也算在区间内。
   */
  const fetchMyHistory = useCallback(
    async (userId: string, filter: AttendanceHistoryFilter): Promise<AttendanceHistoryResult> => {
      let query = client
        .from('attendances')
        .select('*, rehearsals!inner(start_time, end_time, location, repertoire)')
        .eq('user_id', userId)
      if (filter.startDate) query = query.gte('rehearsals.start_time', filter.startDate)
      if (filter.endDate) query = query.lt('rehearsals.start_time', nextDayString(filter.endDate))
      query = query.order('start_time', { referencedTable: 'rehearsals', ascending: false })

      const { data: rows, error: dbError } = await query
      if (dbError) {
        if (mountedRef.current) setError(dbError.message)
        return { rows: [], error: dbError.message }
      }
      return { rows: (rows as AttendanceHistoryRow[]) ?? [], error: null }
    },
    [client]
  )

  return {
    map,
    list,
    loading,
    error,
    saving,
    fetchMyAttendances,
    fetchByRehearsal,
    fetchMyHistory,
    upsert,
    signIn,
    updateStatus,
    batchInsert,
    fetchStats,
  }
}
