import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { SharedScoreFileRow } from '@/types/database'

/**
 * 共享谱列表（`sheet_music_shared_score_files` 视图）。
 * 范围过滤在 UI 侧做（见 lib/shared-scores.ts）；RLS 允许全团读。
 */
export function useSharedScoreFiles() {
  const [data, setData] = useState<SharedScoreFileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    const { data: rows, error: dbError } = await supabase
      .from('sheet_music_shared_score_files')
      .select('*')
      .order('updated_at', { ascending: false, nullsFirst: false })
    setLoading(false)
    if (dbError) {
      setError(dbError.message)
      setData([])
      return
    }
    setError(null)
    setData((rows ?? []) as SharedScoreFileRow[])
  }, [])

  useEffect(() => {
    void fetch()
  }, [fetch])

  return { data, loading, error, fetch }
}
