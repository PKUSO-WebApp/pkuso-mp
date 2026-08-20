import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
import type { RehearsalRow } from '@/types/database'

// 排练管理 hook（成员端列表 / 管理员增删改）。
// 与 Web 版差异：小程序不用 realtime，仅挂载时查询 + 手动重取；
// 加载失败错误归一化为中文文案；卸载后不再 setState（mountedRef 标志位）。
export function useRehearsals(client: typeof defaultClient = defaultClient) {
  const [data, setData] = useState<RehearsalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // 卸载标志位：请求返回时组件已卸载则跳过 setState（防内存泄漏/告警）
  const mountedRef = useRef(true)
  const savingRef = useRef(false)
  const fetchSeqRef = useRef(0)

  const fetch = useCallback(async () => {
    if (!mountedRef.current) return
    const seq = ++fetchSeqRef.current
    setLoading(true)
    const { data: rows, error: dbError } = await client
      .from('rehearsals')
      .select('*')
      .order('start_time', { ascending: false })
    if (!mountedRef.current || seq !== fetchSeqRef.current) return
    setLoading(false)
    if (dbError) {
      // 错误归一化：加载失败统一中文文案（不抛，由页面展示 error）
      setError('数据加载失败，请重试')
      setData([])
      return
    }
    setError(null)
    setData((rows as RehearsalRow[]) ?? [])
  }, [client])

  useEffect(() => {
    mountedRef.current = true
    void fetch()
    return () => {
      mountedRef.current = false
    }
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
          if (mountedRef.current) setError(dbError?.message ?? '创建失败')
          return null
        }
        await fetch()
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
          if (mountedRef.current) setError(dbError.message)
          return false
        }
        if (!updated || updated.length === 0) {
          if (mountedRef.current) setError('排练不存在或更新未生效')
          return false
        }
        await fetch()
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
          if (mountedRef.current) setError(dbError.message)
          return false
        }
        await fetch()
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
