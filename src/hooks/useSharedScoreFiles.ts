import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { SharedScoreFileRow } from '@/types/database'

/**
 * 共享谱列表（`sheet_music_shared_score_files` 视图）。
 * 范围过滤在 UI 侧做（见 lib/shared-scores.ts）；RLS 允许全团读。
 *
 * `enabled: false` 供曲目详情 / 声部页在**非共享入口**时跳过查询 —— 那两个页面
 * 平时走普通谱务路径，不需要为了共享模式多打一次请求。
 */
export function useSharedScoreFiles({ enabled = true }: { enabled?: boolean } = {}) {
  const [data, setData] = useState<SharedScoreFileRow[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!enabled) {
      setLoading(false)
      return
    }
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
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    void fetch()
  }, [enabled, fetch])

  return { data, loading, error, fetch }
}
