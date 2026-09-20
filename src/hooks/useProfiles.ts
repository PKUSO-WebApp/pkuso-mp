import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
import { APP_ERROR, type AppErrorCode } from '@/lib/appError'
import type { ProfileRow } from '@/types/database'

type ProfileFilter = {
  status?: string
  ids?: string[]
  userId?: string
}

type ProfileInsert = {
  id: string
  email: string
  full_name: string
  instrument: string
  college?: string
  join_date?: string
}

/** 可被编辑的个人资料字段（成员详情弹窗 / 用户编辑个人信息共用） */
export type ProfileUpdatePayload = Partial<
  Pick<
    ProfileRow,
    | 'avatar_url'
    | 'full_name'
    | 'instrument'
    | 'college'
    | 'email'
    | 'phone_number'
    | 'join_date'
    | 'is_in_orchestra'
    | 'hide_email'
    | 'hide_phone'
    | 'hide_join_date'
    | 'hide_college'
    | 'is_section_leader'
  >
>

// 成员资料 hook：列表查询 / 新建 / 自我编辑。
// 与 Web 版差异：
// - 小程序为成员端，无 admin 服务端 REST（approve/reject/approveAll/rejectAll 依赖
//   /api/admin/* + window.fetch），已移除；
// - 加载失败错误归一化为中文文案；卸载后不再 setState（mountedRef 标志位）；
//   userId 由调用方从 useUser() 获取后传入（不自行调 getSession）。
export function useProfiles(filter?: ProfileFilter, client: typeof defaultClient = defaultClient) {
  const [data, setData] = useState<ProfileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AppErrorCode | null>(null)
  const [saving, setSaving] = useState(false)
  const fetchSeqRef = useRef(0)
  const mountedRef = useRef(true)
  const savingRef = useRef(false)

  // 解构出原始值作为 fetch 依赖，避免 filter 对象引用（每次渲染新建）导致 fetch 频繁重建
  const status = filter?.status
  const ids = filter?.ids
  const userId = filter?.userId
  // 区分"没传 userId 字段"（如 admin 审批页全量查询）与"传了 undefined"
  // （如 profile 页 user 未就绪，跳过请求，避免退化为全表 select）
  const hasExplicitUndefinedUserId = filter != null && 'userId' in filter && userId === undefined

  const fetch = useCallback(async (opts?: { silent?: boolean }) => {
    if (!mountedRef.current) return
    const seq = ++fetchSeqRef.current

    // 调用方明确传了 userId: undefined（如 profile 页 user 未就绪）：不发请求，返回空列表
    if (hasExplicitUndefinedUserId) {
      if (!opts?.silent) setLoading(false)
      setData([])
      setError(null)
      return
    }

    if (!opts?.silent) setLoading(true)
    setError(null)

    // 查询改走 profiles_roster 视图（SECURITY DEFINER）——直查 profiles 表
    // 的敏感三列（email/phone_number/join_date）已被拒绝（42501）。视图列与原表同构
    // （仅全列 nullable，且掩码只出现在 hide=true 的行且仅敏感三列），
    // 由下游按 hide 布尔展示「（被隐藏）」，此处断言回 ProfileRow 保持调用方类型不变。
    let query = client.from('profiles_roster').select('*')

    if (status) query = query.eq('status', status as never)
    if (ids && ids.length > 0) query = query.in('id', ids)
    if (userId) query = query.eq('id', userId)

    const { data: rows, error: dbError } = await query

    if (!mountedRef.current) return
    // 只有最新请求的结果才更新 state，避免竞态导致旧数据覆盖新数据
    if (seq !== fetchSeqRef.current) return
    setLoading(false)
    if (dbError) {
      console.error('[useProfiles] 花名册加载失败', dbError)
      setError(APP_ERROR.loadFailed)
      setData([])
      return
    }

    if (userId) {
      setData(Array.isArray(rows) ? (rows as ProfileRow[]) : rows ? [rows as ProfileRow] : [])
    } else {
      setData((rows as ProfileRow[]) ?? [])
    }
  }, [client, status, ids, userId, hasExplicitUndefinedUserId])

  useEffect(() => {
    mountedRef.current = true
    void fetch()
    return () => {
      mountedRef.current = false
    }
  }, [fetch])

  const insert = useCallback(
    async (profile: ProfileInsert) => {
      if (saving || savingRef.current) return false
      savingRef.current = true
      setSaving(true)
      try {
        const { error: dbError } = await client.from('profiles').insert(profile as never)
        if (dbError) {
          if (mountedRef.current) setError(APP_ERROR.saveFailed)
          return false
        }
        return true
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    },
    [client, saving]
  )

  /**
   * 更新个人资料（成员用自我 UPDATE 策略）。
   * 成功后直接更新本地 data，避免整页刷新。
   * 通过 .select("id") 检测实际更新行数：RLS 拒绝时 PostgREST 返回 200 + 空数据
   * （静默失败），0 行更新视为失败，避免 UI 声称成功但数据未写入。
   */
  const update = useCallback(
    async (id: string, payload: ProfileUpdatePayload) => {
      if (saving || savingRef.current) return false
      savingRef.current = true
      setSaving(true)
      try {
        const { data: rows, error: dbError } = await client
          .from('profiles')
          .update(payload as never)
          .eq('id', id)
          .select('id')
        if (dbError) {
          if (mountedRef.current) setError(APP_ERROR.saveFailed)
          return false
        }
        if (!rows || rows.length === 0) {
          if (mountedRef.current) setError(APP_ERROR.saveFailed)
          return false
        }
        if (mountedRef.current) {
          setData((prev) => prev.map((r) => (r.id === id ? { ...r, ...payload } : r)))
          setError(null)
        }
        return true
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    },
    [client, saving]
  )

  return {
    data,
    loading,
    error,
    saving,
    fetch,
    insert,
    update,
  }
}
