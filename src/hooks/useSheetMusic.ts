import { useCallback, useEffect, useState } from 'react'
import { useDidShow } from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
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

/**
 * 谱务曲目列表 hook：`sheet_music` 嵌套 parts/files（三层 RLS 均为所有人可读）。
 * tab 切回静默刷新（`useDidShow`），ListState 的 loadingOnlyWhenEmpty 保证不闪。
 *
 * ⚠️ **不再查 `sheet_music_distributions`**（2026-10-11）：现阶段「分发给我的」按
 * **我的声部**判定（`lib/sheet-music-mine.ts` 的 `myPartOf`），与下发记录无关——
 * 于是这个 hook 也不需要登录态，纯读全量。
 */
export function useSheetMusic() {
  const [items, setItems] = useState<SheetMusicWithParts[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setError(null)
    try {
      const res = await supabase
        .from('sheet_music')
        .select(NESTED_SELECT)
        .order('created_at', { ascending: false })
        .limit(200)
      if (res.error) throw new Error(res.error.message)
      setItems(((res.data ?? []) as Parameters<typeof normalize>[0][]).map(normalize))
      setLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetch()
  }, [fetch])

  useDidShow(() => {
    void fetch()
  })

  return { items, loading, error, fetch }
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
