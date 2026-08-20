import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
import type { AttendanceRowWithUser, AttendanceStatus } from '@/types/database'

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
    async (input: AttendanceSignInInput) => {
      if (savingRef.current) return '请勿重复提交'
      savingRef.current = true
      setSaving(true)
      setError(null)
      try {
        const { error: dbError } = await client.rpc('sign_in_attendance', {
          p_rehearsal_id: input.rehearsal_id,
          p_code: input.code,
        })
        if (dbError) {
          setError(dbError.message)
          return dbError.message
        }
        return null
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

  return {
    map,
    list,
    loading,
    error,
    saving,
    fetchMyAttendances,
    fetchByRehearsal,
    upsert,
    signIn,
    updateStatus,
    batchInsert,
    fetchStats,
  }
}
