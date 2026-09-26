import { useCallback, useEffect, useState } from 'react'
import { useDidShow } from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { useUser } from '@/context/user-context'
import { sortPartsForDisplay } from '@/lib/sheet-music-sort'
import type { SheetMusicFileRow, SheetMusicPartRow, SheetMusicRow } from '@/types/database'

export type SheetMusicPartWithFiles = SheetMusicPartRow & { files: SheetMusicFileRow[] }
export type SheetMusicWithParts = SheetMusicRow & { parts: SheetMusicPartWithFiles[] }

/** 曲目 + 声部 + 文件 一次嵌套查询（三层 RLS 均为所有人可读） */
const NESTED_SELECT = '*, parts:sheet_music_parts(*, files:sheet_music_files(*))'

/** 本地排序：业务契约排序（总谱最前 / INSTRUMENT_ORDER / 拼音 / 分声部号），见 sheet-music-sort.ts */
function normalize(
  s: SheetMusicRow & { parts: (SheetMusicPartRow & { files: SheetMusicFileRow[] })[] }
): SheetMusicWithParts {
  return { ...s, parts: sortPartsForDisplay(s.parts ?? []) }
}

type ScoreListResult = {
  items: SheetMusicWithParts[]
  /** 我被分发的 part_id → 所属曲目 id 列表（「分发给我的」tab 过滤用） */
  myPartsBySheet: Record<string, string[]>
}

/**
 * 谱务曲目列表 hook：
 * - 全量：sheet_music 嵌套 parts/files（RLS 所有人可读）
 * - 分发：sheet_music_distributions 取我的 part_id，回连到曲目（未登录不查）
 * - tab 切回静默刷新（useDidShow），ListState loadingOnlyWhenEmpty 保证不闪
 */
export function useSheetMusic() {
  const { user } = useUser()
  const uid = user?.id ?? null
  const [data, setData] = useState<ScoreListResult>({ items: [], myPartsBySheet: {} })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setError(null)
    try {
      const listPromise = supabase
        .from('sheet_music')
        .select(NESTED_SELECT)
        .order('created_at', { ascending: false })
        .limit(200)

      const distPromise = uid
        ? supabase.from('sheet_music_distributions').select('part_id').eq('user_id', uid)
        : null

      const [listRes, distRes] = await Promise.all([
        listPromise,
        distPromise ? distPromise : Promise.resolve(null),
      ])
      if (listRes.error) throw new Error(listRes.error.message)
      if (distRes?.error) throw new Error(distRes.error.message)

      const items = ((listRes.data ?? []) as Parameters<typeof normalize>[0][]).map(normalize)

      const myPartIds = new Set(
        ((distRes?.data ?? []) as { part_id: string | null }[])
          .map((r) => r.part_id)
          .filter((id): id is string => !!id)
      )
      const myPartsBySheet: Record<string, string[]> = {}
      if (myPartIds.size > 0) {
        for (const s of items) {
          const mine = s.parts.filter((p) => myPartIds.has(p.id)).map((p) => p.id)
          if (mine.length > 0) myPartsBySheet[s.id] = mine
        }
      }
      setData({ items, myPartsBySheet })
      setLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }, [uid])

  useEffect(() => {
    void fetch()
  }, [fetch])

  useDidShow(() => {
    void fetch()
  })

  return { ...data, loading, error, fetch }
}

/** 曲目详情 hook（声部 + 文件，按 id 单查） */
export function useSheetMusicDetail(id: string) {
  const [item, setItem] = useState<SheetMusicWithParts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!id) {
      setLoading(false)
      return
    }
    setError(null)
    try {
      const res = await supabase
        .from('sheet_music')
        .select(NESTED_SELECT)
        .eq('id', id)
        .maybeSingle()
      if (res.error) throw new Error(res.error.message)
      setItem(res.data ? normalize(res.data as Parameters<typeof normalize>[0]) : null)
      setLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void fetch()
  }, [fetch])

  useDidShow(() => {
    void fetch()
  })

  return { item, loading, error, fetch }
}
