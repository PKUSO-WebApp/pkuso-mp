import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
import { APP_ERROR, type AppErrorCode } from '@/lib/appError'
import { useT } from '@/i18n'
import { dataSyncBump, subscribeSync } from '@/lib/dataSync'
import { getLocalDateString, shiftDays, normalizeScheduleTime } from '@/lib/date-utils'
import { invokeFunction } from '@/lib/functions'
import type { RehearsalRow, ScheduleRow } from '@/types/database'

type Listener = () => void

function useSchedule(client: typeof defaultClient = defaultClient) {
  const { t } = useT()
  const [data, setData] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AppErrorCode | null>(null)
  const [saving, setSaving] = useState(false)

  const mountedRef = useRef(true)
  const savingRef = useRef(false)
  const fetchSeqRef = useRef(0)

  // 全量缓存：按周缓存所有排期
  const allSchedulesRef = useRef<ScheduleRow[]>([])
  const cacheVersionRef = useRef<number>(0)
  const listenersRef = useRef<Set<Listener>>(new Set())
  // 作者名缓存：author_id → full_name（跟随排期刷新，避免每次点击 block 都发网络请求）
  const authorNamesRef = useRef<Map<string, string>>(new Map())

  const notifyListeners = useCallback(() => {
    listenersRef.current.forEach((h) => h())
  }, [])

  const subscribe = useCallback((handler: Listener) => {
    listenersRef.current.add(handler)
    return () => {
      listenersRef.current.delete(handler)
    }
  }, [])

  // 核心：全量拉取 8 天数据（today-1 ~ today+7，与日期选择器范围对齐）
  const fetchAll = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!mountedRef.current) return
      const seq = ++fetchSeqRef.current
      if (!opts?.silent) setLoading(true)

      const today = getLocalDateString()
      const rangeStart = shiftDays(today, -1) // 今天-1（含跨天预约缓冲）
      const rangeEnd = shiftDays(today, 7) // 今天+7（与日期选择器对齐）

      let query = client
        .from('schedules')
        .select('*')
        .lt('start_time', rangeEnd + ' 23:59:59')
        .gt('end_time', rangeStart + ' 00:00:00')
        .order('start_time', { ascending: true })

      const { data: rows, error: dbError } = await query
      if (!mountedRef.current || seq !== fetchSeqRef.current) return
      setLoading(false)

      if (dbError) {
        console.error('[useSchedule] 预约加载失败', dbError)
        setError(APP_ERROR.loadFailed)
        setData([])
        return
      }
      setError(null)

      const normalized = ((rows as ScheduleRow[]) ?? []).map((row) => ({
        ...row,
        start_time: normalizeScheduleTime(row.start_time),
        end_time: normalizeScheduleTime(row.end_time),
      }))

      allSchedulesRef.current = normalized
      cacheVersionRef.current += 1
      notifyListeners()

      // 批量获取作者名并缓存
      const authorIds = [
        ...new Set(normalized.map((s) => s.author_id).filter((id): id is string => !!id)),
      ]
      if (authorIds.length > 0) {
        // 先清除旧缓存（避免已删除/改名的用户残留旧数据）
        authorNamesRef.current = new Map()
        const { data: authorRows } = await client
          .from('profiles_roster')
          .select('id, full_name')
          .in('id', authorIds)
        if (authorRows) {
          for (const row of authorRows as { id: string; full_name: string | null }[]) {
            if (row.full_name) authorNamesRef.current.set(row.id, row.full_name)
          }
        }
        // 未查到的 author_id 保留空缺（getAuthorName 返回 null，组件兜底处理）
      } else {
        authorNamesRef.current = new Map()
      }

      // 同时更新当天视图
      const todayData = normalized.filter((s) => {
        const sd = s.start_time.split('T')[0]
        const ed = s.end_time?.split('T')[0] ?? sd
        return sd === today || ed === today
      })
      setData(todayData)
    },
    [client, notifyListeners]
  )

  // 兼容旧接口：单日 fetch（走缓存，命中则同步返回）
  const fetch = useCallback(
    async (date?: string, opts?: { silent?: boolean }) => {
      const targetDate = date ?? getLocalDateString()

      // 缓存命中：同步返回当天切片
      if (allSchedulesRef.current.length > 0) {
        const dayData = allSchedulesRef.current.filter((s) => {
          const sd = s.start_time.split('T')[0]
          const ed = s.end_time?.split('T')[0] ?? sd
          return sd === targetDate || ed === targetDate
        })
        setData(dayData)
        return
      }
      // 缓存未命中：全量拉取
      await fetchAll(opts)
    },
    [fetchAll]
  )

  // 纯内存切片：按日期取当天预约（含跨天）
  const getByDate = useCallback((date: string): ScheduleRow[] => {
    return allSchedulesRef.current.filter((s) => {
      const sd = s.start_time.split('T')[0]
      const ed = s.end_time?.split('T')[0] ?? sd
      return sd === date || ed === date
    })
  }, [])

  // 同步读取作者名缓存；null authorId 或缓存未命中返回 null（组件可显示兜底文案）
  const getAuthorName = useCallback((authorId: string | null): string | null => {
    if (!authorId) return null
    return authorNamesRef.current.get(authorId) ?? null
  }, [])

  // 异步获取作者名：缓存命中同步返回，未命中发起单条查询并填充缓存
  const ensureAuthorName = useCallback(
    async (authorId: string | null): Promise<string | null> => {
      if (!authorId) return null
      const cached = authorNamesRef.current.get(authorId)
      if (cached) return cached
      const { data: row } = await client
        .from('profiles_roster')
        .select('full_name')
        .eq('id', authorId)
        .maybeSingle()
      if (row?.full_name) {
        authorNamesRef.current.set(authorId, row.full_name)
        return row.full_name
      }
      return null
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

  // 订阅 dataSync schedules 变化事件：收到事件后静默刷新缓存
  useEffect(() => {
    return subscribeSync('schedules', () => {
      void fetchAll({ silent: true })
    })
  }, [fetchAll])

  const create = useCallback(
    async (payload: Record<string, unknown>, _date?: string) => {
      if (savingRef.current) return false
      savingRef.current = true
      setSaving(true)
      try {
        const title = typeof payload.title === 'string' ? payload.title.trim() : ''
        if (title) {
          const textRes = await invokeFunction(client, 'wechat-content-check', {
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
        // 写入成功 -> bump 同步版本 -> 后台全量刷新
        dataSyncBump()
        await fetchAll({ silent: true })
        return true
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    },
    [client, fetchAll]
  )

  const update = useCallback(
    async (id: number, payload: Record<string, unknown>, _date?: string) => {
      if (savingRef.current) return false
      savingRef.current = true
      setSaving(true)
      try {
        const { data: updated, error: dbError } = await client
          .from('schedules')
          .update(payload as never)
          .eq('id', id)
          .select('id')
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
        dataSyncBump()
        await fetchAll({ silent: true })
        return true
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    },
    [client, fetchAll]
  )

  const remove = useCallback(
    async (id: number, _date?: string) => {
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
        dataSyncBump()
        await fetchAll({ silent: true })
        return true
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    },
    [client, fetchAll]
  )

  // 检查时间冲突：本地内存跑，省 RPC
  const checkConflict = useCallback(
    async (
      startDate: string,
      startTime: string,
      endDate: string,
      endTime: string,
      excludeRehearsalId?: number
    ): Promise<string | null> => {
      // pre-check: 强制刷新缓存，确保冲突检测基于最新数据
      await fetchAll({ silent: true })

      const startDateTime = `${startDate}T${startTime}:00`
      const endDateTime = `${endDate}T${endTime}:00`

      // 仅需检查开始/结束两天的数据
      const relevant = getByDate(startDate).concat(getByDate(endDate))

      // 人工预约冲突（rehearsal_id 为 null）
      const scheduleConflict = relevant.find((s) => {
        if (s.rehearsal_id) return false // 跳过排练影子行
        const sStart = s.start_time
        const sEnd = s.end_time || sStart
        return startDateTime < sEnd && endDateTime > sStart
      })

      if (scheduleConflict) {
        return t('schedule.errors.scheduleConflict')
      }

      // 排练冲突：需 RPC 查询（排练表不在全量缓存里）
      const [startYear, startMonth, startDay] = startDate.split('-').map(Number)
      const [endYear, endMonth, endDay] = endDate.split('-').map(Number)
      const rehearsalStartOfDay = `${startYear}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}T00:00:00`
      const rehearsalEndOfDay = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}T23:59:59`

      const { data: rehearsals, error: rehearsalError } = await client
        .from('rehearsals')
        .select('*')
        .gte('start_time', rehearsalStartOfDay)
        .lte('start_time', rehearsalEndOfDay)
        .neq('id', excludeRehearsalId ?? -1)

      if (rehearsalError) {
        return t('schedule.errors.queryRehearsalFailed')
      }

      const rehearsalConflict = (rehearsals as RehearsalRow[])?.find((r) => {
        const rehearsalStart = r.start_time
        const rehearsalEnd = r.end_time || r.start_time
        if (!rehearsalStart || !rehearsalEnd) return false
        return startDateTime < rehearsalEnd && endDateTime > rehearsalStart
      })

      if (rehearsalConflict) {
        return t('schedule.errors.rehearsalConflict')
      }

      return null
    },
    [client, t, getByDate, fetchAll]
  )

  return {
    data,
    loading,
    error,
    saving,
    fetch,
    fetchAll,
    getByDate,
    getAuthorName,
    ensureAuthorName,
    subscribe,
    create,
    update,
    remove,
    checkConflict,
  }
}

export { useSchedule }
