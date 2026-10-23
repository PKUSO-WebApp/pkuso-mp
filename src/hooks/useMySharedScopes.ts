import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * 共享谱的可见/可编辑范围：
 * - `my_managed_sections`：声部长（组展开）+ 首席乐器（+ attendance 能力的团长）；
 * - `my_capabilities`：用于 `shared_score` 能力（团长/admin）——它不在 managed_sections 里。
 */
export function useMySharedScopes() {
  const [managedSections, setManagedSections] = useState<string[]>([])
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [managedRes, capsRes] = await Promise.all([
          supabase.rpc('my_managed_sections'),
          supabase.rpc('my_capabilities'),
        ])
        if (cancelled) return
        setManagedSections((managedRes.data as string[] | null) ?? [])
        setCapabilities((capsRes.data as string[] | null) ?? [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return { managedSections, capabilities, loading }
}
