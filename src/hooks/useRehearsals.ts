import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
import { dataSyncBump, subscribeSync } from '@/lib/dataSync'
import { APP_ERROR, type AppErrorCode } from '@/lib/appError'
import type { RehearsalRow } from '@/types/database'

// 跨页面共享缓存：首页加载后，详情页/请假页无需重新拉取即可立即拿到数据，
// 也避免「会话失效导致重取失败 → 列表被清空 → 排练不存在/未找到」的误判（Issue #…）。
let rehearsalsCache: RehearsalRow[] | null = null

// 仅供测试重置跨用例的模块级缓存；生产代码不应调用
export function __resetRehearsalsCache() {
  rehearsalsCache = null
}

// 排练管理 hook（成员端列表 / 管理员增删改）。
// 与 Web 版差异：小程序不用 realtime，仅挂载时查询 + 手动重取；
// 加载失败错误归一化为中文文案；卸载后不再 setState（mountedRef 标志位）。
export function useRehearsals(client: typeof defaultClient = defaultClient) {
  const [data, setData] = useState<RehearsalRow[]>(rehearsalsCache ?? [])
  const [loading, setLoading] = useState(rehearsalsCache === null)
  const [error, setError] = useState<AppErrorCode | null>(null)
  const [saving, setSaving] = useState(false)
  // 卸载标志位：请求返回时组件已卸载则跳过 setState（防内存泄漏/告警）
  const mountedRef = useRef(true)
  const savingRef = useRef(false)
  const fetchSeqRef = useRef(0)

  const fetch = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!mountedRef.current) return
      const seq = ++fetchSeqRef.current
      if (!opts?.silent) setLoading(true)
      const { data: rows, error: dbError } = await client
        .from('rehearsals')
        .select('*')
        .order('start_time', { ascending: false })
      if (!mountedRef.current || seq !== fetchSeqRef.current) return
      setLoading(false)
      if (dbError) {
        // 失败（网络/会话失效）时上报错误码，但保留已有缓存、不把列表清空，
        // 否则单设备会话被踢等场景下页面会误显示「排练不存在/未找到」
        console.error('[useRehearsals] 排练加载失败', dbError)
        setError(APP_ERROR.loadFailed)
        return
      }
      setError(null)
      const next = (rows as RehearsalRow[]) ?? []
      rehearsalsCache = next
      setData(next)
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

  // 心跳检测到「我的可见排练」版本变化后静默重取（不翻 loading，避免闪烁）
  useEffect(() => {
    const handler = () => {
      void fetch({ silent: true })
    }
    return subscribeSync('rehearsals', handler)
  }, [fetch])

  const create = useCallback(
    async (payload: Record<string, unknown>) => {
      if (savingRef.current) return null
      savingRef.current = true
      setSaving(true)
      try {
        const { data: inserted, error: dbError } = await client
          .from('rehearsals')
          .insert([payload] as never)
          .select('id')
          .single()
        if (dbError || !inserted) {
          if (mountedRef.current) {
            console.error('[useRehearsals] 创建失败', dbError)
            setError(APP_ERROR.saveFailed)
          }
          return null
        }
        await fetch()
        dataSyncBump()
        return (inserted as { id: number }).id
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    },
    [client, fetch]
  )

  const update = useCallback(
    async (id: number, payload: Record<string, unknown>) => {
      if (savingRef.current) return false
      savingRef.current = true
      setSaving(true)
      // updated_at 由 DB 触发器统一写入（BEFORE UPDATE ... SET NEW.updated_at = now()），
      // 与 created_at 同源时钟，避免客户端时钟漂移导致「更新」chip 假阴性
      const { data: updated, error: dbError } = await client
        .from('rehearsals')
        .update(payload as never)
        .eq('id', id)
        .select('id')
      try {
        if (dbError) {
          if (mountedRef.current) {
            console.error('[useRehearsals] 更新失败', dbError)
            setError(APP_ERROR.saveFailed)
          }
          return false
        }
        if (!updated || updated.length === 0) {
          if (mountedRef.current) setError(APP_ERROR.saveFailed)
          return false
        }
        await fetch()
        dataSyncBump()
        return true
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    },
    [client, fetch]
  )

  const remove = useCallback(
    async (id: number) => {
      if (savingRef.current) return false
      savingRef.current = true
      setSaving(true)
      try {
        const { error: dbError } = await client.from('rehearsals').delete().eq('id', id)
        if (dbError) {
          if (mountedRef.current) {
            console.error('[useRehearsals] 删除失败', dbError)
            setError(APP_ERROR.saveFailed)
          }
          return false
        }
        await fetch()
        dataSyncBump()
        return true
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    },
    [client, fetch]
  )

  return { data, loading, error, saving, fetch, create, update, remove }
}
