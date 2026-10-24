import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * 成员默认分声部的读侧（P7c）。
 *
 * ⚠️ **条件 UI 不许等异步条件才出现**（用户 2026-10-24 指出的通用问题）：
 * 分声部卡片是否显示依赖「调用者有没有写权」「该声部属于哪一类」这些异步条件。
 * 若每次都等 RPC / 查询回来再渲染，用户每次进详情页都会先看到卡片缺位、随后才弹出。
 *
 * 处理办法：
 *   1. **模块级缓存**：同一会话内重进同一成员直接拿到上次的值（先显示，后台再核对）；
 *   2. **并行取数**：权限、偏好、声部类别、可用号一次并发，而不是串成两轮；
 *   3. **显隐提示**：调用方可以用已缓存的 profile flags（是否声部长/首席）先决定
 *      「要不要占位」，不知道时才退回等权限结果。
 *
 * 缓存只在内存里（按 owner + member 隔离），不落 storage：权限被撤销后下次进入
 * 会由后台核对纠正，不会长期留一份过期的写权。
 */

export type MemberPreferenceData = {
  canSet: boolean
  value: number | null
  /** 该乐器所属的声部组（来自 section_group_members 字典） */
  groups: string[]
  /** 该声部现有分谱文件里出现过的分声部号（管乐用于补充 >4 的号） */
  observedNumbers: number[]
}

type InstrumentMeta = Pick<MemberPreferenceData, 'groups' | 'observedNumbers'>

const preferenceCache = new Map<string, MemberPreferenceData>()
const instrumentMetaCache = new Map<string, Promise<InstrumentMeta>>()

const cacheKeyOf = (ownerId: string, memberId: string) => `${ownerId}:${memberId}`

async function loadInstrumentMeta(instrument: string): Promise<InstrumentMeta> {
  const cached = instrumentMetaCache.get(instrument)
  if (cached) return cached

  const promise = (async () => {
    const [groupsRes, partsRes] = await Promise.all([
      supabase.from('section_group_members').select('group_name').eq('member_name', instrument),
      supabase
        .from('sheet_music_parts')
        .select('files:sheet_music_files(sub_parts)')
        .eq('section', instrument),
    ])
    if (groupsRes.error) throw new Error(groupsRes.error.message)
    if (partsRes.error) throw new Error(partsRes.error.message)

    const groups = ((groupsRes.data ?? []) as { group_name: string }[]).map((g) => g.group_name)
    const observedNumbers = ((partsRes.data ?? []) as unknown as {
      files: { sub_parts: number[] | null }[] | null
    }[])
      .flatMap((p) => p.files ?? [])
      .flatMap((f) => f.sub_parts ?? [])
      .filter((n) => Number.isInteger(n) && n > 0)
    return { groups, observedNumbers: [...new Set(observedNumbers)].sort((a, b) => a - b) }
  })()

  // 失败不缓存：下次进入重试（字典/文件查询失败不该被记成「没有这些数据」）
  promise.catch(() => instrumentMetaCache.delete(instrument))
  instrumentMetaCache.set(instrument, promise)
  return promise
}

async function loadPreference(memberId: string, instrument: string): Promise<MemberPreferenceData | null> {
  try {
    const [permRes, prefRes, meta] = await Promise.all([
      supabase.rpc('can_set_preference', { p_member: memberId }),
      supabase
        .from('section_member_preferences')
        .select('preferred_sub_part')
        .eq('user_id', memberId)
        .maybeSingle(),
      loadInstrumentMeta(instrument),
    ])
    if (permRes.error || prefRes.error) return null
    return {
      canSet: !!permRes.data,
      value:
        (prefRes.data as { preferred_sub_part: number | null } | null)?.preferred_sub_part ?? null,
      groups: meta.groups,
      observedNumbers: meta.observedNumbers,
    }
  } catch {
    return null
  }
}

export function useMemberPreference(params: {
  ownerId: string | null
  memberId: string
  instrument: string
}) {
  const { ownerId, memberId, instrument } = params
  const cacheKey = ownerId && memberId && instrument ? cacheKeyOf(ownerId, memberId) : ''
  const cached = cacheKey ? (preferenceCache.get(cacheKey) ?? null) : null
  const [data, setData] = useState<MemberPreferenceData | null>(cached)
  const [loading, setLoading] = useState(!cached)

  useEffect(() => {
    const hit = cacheKey ? (preferenceCache.get(cacheKey) ?? null) : null
    setData(hit)
    if (!cacheKey || !memberId || !instrument) {
      setLoading(false)
      return
    }
    setLoading(!hit)

    let cancelled = false
    void loadPreference(memberId, instrument).then((next) => {
      if (cancelled) return
      if (next) {
        preferenceCache.set(cacheKey, next)
        setData(next)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [cacheKey, instrument, memberId])

  const save = useCallback(
    async (value: number | null): Promise<boolean> => {
      if (!ownerId || !memberId) return false
      const { error } = await supabase.rpc('set_member_preference', {
        p_member: memberId,
        // 生成的 RPC 参数类型不表达可空（SQL 里 null = 清除）；与 p_strokes 同款放宽
        p_sub_part: value as never,
      })
      if (error) return false
      setData((prev) => {
        if (!cacheKey) return prev
        const next: MemberPreferenceData = {
          canSet: prev?.canSet ?? true,
          value,
          groups: prev?.groups ?? [],
          observedNumbers: prev?.observedNumbers ?? [],
        }
        preferenceCache.set(cacheKey, next)
        return next
      })
      return true
    },
    [cacheKey, memberId, ownerId]
  )

  return { data, loading, save }
}
