import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
import { APP_ERROR, type AppErrorCode } from '@/lib/appError'
import type { RehearsalRow, ScheduleRow } from '@/types/database'

// 排练房预约 hook。
// 与 Web 版差异：无 realtime（本就是挂载查询 + 手动重取）；
// 加载失败错误归一化为中文文案；卸载后不再 setState（mountedRef 标志位）。

/**
 * schedules.start_time 在库中为「YYYY-MM-DD HH:mm:ss」（空格分隔，触发器与
 * 预约表单写入均为此格式），而日期工具链（parseLocalISO/formatTime）按
 * 「YYYY-MM-DDTHH:mm:ss」解析。统一在 hook 边界归一化为 T 分隔：
 * - 日期区间过滤用空格格式（与库中值一致，lexicographic 比较才正确——
 *   空格(0x20) < T(0x54)，用 T 格式过滤会把所有空格行排在区间外，查询恒空）；
 * - 查询结果归一化为 T 分隔后返回，下游时间解析/展示直接可用。
 */
function normalizeScheduleTime(value: string): string
function normalizeScheduleTime(value: string | null): string | null
function normalizeScheduleTime(value: string | null): string | null {
  if (!value) return value
  if (value.includes('T')) return value
  return value.replace(' ', 'T')
}

export function useSchedule(client: typeof defaultClient = defaultClient) {
  const [data, setData] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AppErrorCode | null>(null)
  const [saving, setSaving] = useState(false)
  const mountedRef = useRef(true)
  const savingRef = useRef(false)
  const fetchSeqRef = useRef(0)

  const fetch = useCallback(
    async (date?: string, opts?: { silent?: boolean }) => {
      if (!mountedRef.current) return
      const seq = ++fetchSeqRef.current
      if (!opts?.silent) setLoading(true)
      let query = client.from('schedules').select('*').order('start_time', { ascending: true })

      if (date) {
        // 按本地日期筛选，避免时区问题；空格分隔与库中存储格式一致
        const [year, month, day] = date.split('-').map(Number)
        const startOfDay = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} 00:00:00`
        const endOfDay = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} 23:59:59`

        query = query.gte('start_time', startOfDay).lte('start_time', endOfDay)
      }

      const { data: rows, error: dbError } = await query
      if (!mountedRef.current || seq !== fetchSeqRef.current) return
      setLoading(false)
      if (dbError) {
        // 错误码化（P2-7）：原始错误仅记录
        console.error('[useSchedule] 预约加载失败', dbError)
        setError(APP_ERROR.loadFailed)
        setData([])
        return
      }
      setError(null)
      // 归一化时间格式（空格 → T 分隔）后再交给页面解析
      setData(
        ((rows as ScheduleRow[]) ?? []).map((row) => ({
          ...row,
          start_time: normalizeScheduleTime(row.start_time),
          end_time: normalizeScheduleTime(row.end_time),
        }))
      )
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
        // 文本审核：日程标题
        const title = typeof payload.title === 'string' ? payload.title.trim() : ''
        if (title) {
          const textRes = await client.functions.invoke('wechat-content-check', {
            body: { kind: 'text', content: title },
          })
          const textData = textRes.data as { result?: string; ok?: boolean } | null
          if (textRes.error) {
            console.warn('[useSchedule] 标题审核调用失败，放行：', textRes.error)
          } else if (textData?.result === 'block') {
            if (mountedRef.current) setError(APP_ERROR.saveFailed)
            return false
          }
        }
        const { error: dbError } = await client.from('schedules').insert([payload] as never)
        if (dbError) {
          if (mountedRef.current) {
            console.error('[useSchedule] 写操作失败', dbError)
            setError(APP_ERROR.saveFailed)
          }
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
          if (mountedRef.current) {
            console.error('[useSchedule] 写操作失败', dbError)
            setError(APP_ERROR.saveFailed)
          }
          return false
        }
        if (!updated || updated.length === 0) {
          if (mountedRef.current) setError(APP_ERROR.saveFailed)
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
          if (mountedRef.current) {
            console.error('[useSchedule] 写操作失败', dbError)
            setError(APP_ERROR.saveFailed)
          }
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
      // 预约表空格分隔、排练表 T 分隔，区间上下界分别按各自存储格式构造
      const scheduleStartOfDay = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} 00:00:00`
      const scheduleEndOfDay = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} 23:59:59`
      const rehearsalStartOfDay = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00`
      const rehearsalEndOfDay = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T23:59:59`

      const startDateTime = `${date}T${startTime}:00`
      const endDateTime = `${date}T${endTime}:00`

      // 只查人工预约：rehearsal_id 非空的行是排练触发器生成的影子行，
      // 由下方排练分支统一检查（编辑排练时 neq 排除自身，避免自己和自己冲突；
      // 若此处混入影子行，编辑排练会误报「该时间段已有其他预约」，且文案不准确）
      const { data: existingSchedules, error: scheduleError } = await client
        .from('schedules')
        .select('*')
        .gte('start_time', scheduleStartOfDay)
        .lte('start_time', scheduleEndOfDay)
        .is('rehearsal_id', null)

      if (scheduleError) {
        return '查询预约失败'
      }

      // 查询当天的排练（排除正在编辑的排练）
      const { data: rehearsals, error: rehearsalError } = await client
        .from('rehearsals')
        .select('*')
        .gte('start_time', rehearsalStartOfDay)
        .lte('start_time', rehearsalEndOfDay)
        .neq('id', excludeRehearsalId ?? -1)

      if (rehearsalError) {
        return '查询排练安排失败'
      }

      // 检查与已有预约的冲突（库中空格分隔，先归一化再与 T 分隔的新预约比较）
      const scheduleConflict = (existingSchedules as ScheduleRow[])?.find((s) => {
        const sStart = normalizeScheduleTime(s.start_time)
        if (!sStart) return false
        const sEnd = normalizeScheduleTime(s.end_time) || sStart
        // 时间重叠条件：新预约开始 < 已有结束，且新预约结束 > 已有开始
        return startDateTime < sEnd && endDateTime > sStart
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
