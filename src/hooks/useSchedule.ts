import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
import type { RehearsalRow, ScheduleRow } from '@/types/database'

// 排练房预约 hook。
// 与 Web 版差异：无 realtime（本就是挂载查询 + 手动重取）；
// 加载失败错误归一化为中文文案；卸载后不再 setState（mountedRef 标志位）。
export function useSchedule(client: typeof defaultClient = defaultClient) {
  const [data, setData] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const mountedRef = useRef(true)
  const savingRef = useRef(false)
  const fetchSeqRef = useRef(0)

  const fetch = useCallback(
    async (date?: string) => {
      if (!mountedRef.current) return
      const seq = ++fetchSeqRef.current
      setLoading(true)
      let query = client.from('schedules').select('*').order('start_time', { ascending: true })

      if (date) {
        // 按本地日期筛选，避免时区问题
        const [year, month, day] = date.split('-').map(Number)
        // 手动构造本地时间的 ISO 字符串，避免 toISOString() 的时区转换
        const startOfDay = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00`
        const endOfDay = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T23:59:59`

        query = query.gte('start_time', startOfDay).lte('start_time', endOfDay)
      }

      const { data: rows, error: dbError } = await query
      if (!mountedRef.current || seq !== fetchSeqRef.current) return
      setLoading(false)
      if (dbError) {
        // 错误归一化：加载失败统一中文文案
        setError('数据加载失败，请重试')
        setData([])
        return
      }
      setError(null)
      setData((rows as ScheduleRow[]) ?? [])
    },
    [client]
  )

  useEffect(() => {
    mountedRef.current = true
    void fetch()
    return () => {
      mountedRef.current = false
    }
  }, [fetch])

  const create = useCallback(
    async (payload: Record<string, unknown>, date?: string) => {
      if (savingRef.current) return false
      savingRef.current = true
      setSaving(true)
      try {
        const { error: dbError } = await client.from('schedules').insert([payload] as never)
        if (dbError) {
          if (mountedRef.current) setError(dbError.message)
          return false
        }
        if (mountedRef.current) setError(null)
        await fetch(date)
        return true
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    },
    [client, fetch]
  )

  const update = useCallback(
    async (id: number, payload: Record<string, unknown>, date?: string) => {
      if (savingRef.current) return false
      savingRef.current = true
      setSaving(true)
      const { data: updated, error: dbError } = await client
        .from('schedules')
        .update(payload as never)
        .eq('id', id)
        .select('id')
      try {
        if (dbError) {
          if (mountedRef.current) setError(dbError.message)
          return false
        }
        if (!updated || updated.length === 0) {
          if (mountedRef.current) setError('预约不存在或更新未生效')
          return false
        }
        if (mountedRef.current) setError(null)
        await fetch(date)
        return true
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    },
    [client, fetch]
  )

  const remove = useCallback(
    async (id: number, date?: string) => {
      if (savingRef.current) return false
      savingRef.current = true
      setSaving(true)
      try {
        const { error: dbError } = await client.from('schedules').delete().eq('id', id)
        if (dbError) {
          if (mountedRef.current) setError(dbError.message)
          return false
        }
        if (mountedRef.current) setError(null)
        await fetch(date)
        return true
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    },
    [client, fetch]
  )

  // 检查时间冲突（不支持跨天预约）
  const checkConflict = useCallback(
    async (
      date: string,
      startTime: string,
      endTime: string,
      excludeRehearsalId?: number
    ): Promise<string | null> => {
      const [year, month, day] = date.split('-').map(Number)
      const startOfDay = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00`
      const endOfDay = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T23:59:59`

      const startDateTime = `${date}T${startTime}:00`
      const endDateTime = `${date}T${endTime}:00`

      // 只查人工预约：rehearsal_id 非空的行是排练触发器生成的影子行，
      // 由下方排练分支统一检查（编辑排练时 neq 排除自身，避免自己和自己冲突；
      // 若此处混入影子行，编辑排练会误报「该时间段已有其他预约」，且文案不准确）
      const { data: existingSchedules, error: scheduleError } = await client
        .from('schedules')
        .select('*')
        .gte('start_time', startOfDay)
        .lte('start_time', endOfDay)
        .is('rehearsal_id', null)

      if (scheduleError) {
        return '查询预约失败'
      }

      // 查询当天的排练（排除正在编辑的排练）
      const { data: rehearsals, error: rehearsalError } = await client
        .from('rehearsals')
        .select('*')
        .gte('start_time', startOfDay)
        .lte('start_time', endOfDay)
        .neq('id', excludeRehearsalId ?? -1)

      if (rehearsalError) {
        return '查询排练安排失败'
      }

      // 检查与已有预约的冲突
      const scheduleConflict = (existingSchedules as ScheduleRow[])?.find((s) => {
        // 时间重叠条件：新预约开始 < 已有结束，且新预约结束 > 已有开始
        return startDateTime < (s.end_time || s.start_time) && endDateTime > s.start_time
      })

      if (scheduleConflict) {
        return '该时间段已有其他预约'
      }

      // 检查与排练的冲突
      const rehearsalConflict = (rehearsals as RehearsalRow[])?.find((r) => {
        const rehearsalStart = r.start_time
        const rehearsalEnd = r.end_time || r.start_time
        if (!rehearsalStart || !rehearsalEnd) return false
        return startDateTime < rehearsalEnd && endDateTime > rehearsalStart
      })

      if (rehearsalConflict) {
        return '该时间段已有排练安排'
      }

      return null
    },
    [client]
  )

  return { data, loading, error, saving, fetch, create, update, remove, checkConflict }
}
