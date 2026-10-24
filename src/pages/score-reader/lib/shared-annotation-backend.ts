import { supabase } from '@/lib/supabase'
import type { AnnoDoc, AnnoStroke } from '@/lib/annotation'
import { mergeStrokes, pageFingerprint } from '@/lib/annotation-sync'
import type { ReaderAnnotationBackend } from './annotation-backend'

export type SharedSaveState = 'saving' | 'saved' | 'error'

export type SharedAnnotationConflict = {
  page: number
  local: AnnoStroke[]
  remote: AnnoStroke[]
  remoteVersion: string
}

export type SharedConflictChoice = 'local' | 'remote' | 'merge'

export type SharedAnnotationBackendCallbacks = {
  onSaveState?: (state: SharedSaveState) => void
  onConflict?: (conflicts: SharedAnnotationConflict[]) => void
}

export type SharedAnnotationBackend = ReaderAnnotationBackend & {
  kind: 'shared'
  retry?: () => void
  /**
   * 立刻把挂着的写入发完，并告诉你**是否真的发完了**。
   * 进「个人 → 共享」合并前必须等它 true：合并读的是共享表的当前内容，
   * 还有未落盘的共享编辑时进去，会把刚画的笔迹留在本地、合并完再撞一次 CAS。
   */
  flushNow: () => Promise<boolean>
  /** 当前某一页的冲突快照（预览页提交失败时用来判断是「又变了」还是网络失败） */
  getConflict: (page: number) => SharedAnnotationConflict | undefined
  /** 冲突解决：local/merge 会写回共享表；remote 只采纳远端 */
  resolveConflict: (page: number, choice: SharedConflictChoice) => Promise<AnnoStroke[] | null>
}

/** 停笔后合并多次写入的防抖（共享谱每次 CAS 是一次网络往返） */
const DEBOUNCE_MS = 600

type RpcRow = { ok: boolean; version: string | null; strokes: unknown }

const cloneDoc = (doc: AnnoDoc): AnnoDoc => JSON.parse(JSON.stringify(doc)) as AnnoDoc

/**
 * 共享谱 backend（P6b）：读 `sheet_music_shared_annotations`，写走 P5 的 CAS RPC。
 *
 * - load 同时取 can_edit_shared_annotation 决定 readOnly；
 * - persist 只把「与上次已知内容不同」的页放进 dirty，600ms 防抖后逐页 CAS；
 * - CAS 冲突不覆盖：记下 local/remote/version，交给 SharedConflictSheet 三选一；
 * - 页面关闭/卸载时 flush 一次，避免最后一笔丢在防抖里。
 */
export function createSharedAnnotationBackend(
  callbacks: SharedAnnotationBackendCallbacks
): SharedAnnotationBackend {
  let readOnly = true
  let currentFileId = ''
  let baseDoc: AnnoDoc = {}
  let versions: Record<number, string> = {}
  let dirty = new Map<number, AnnoStroke[]>()
  let conflicts = new Map<number, SharedAnnotationConflict>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let flushing = false

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  const setState = (state: SharedSaveState) => callbacks.onSaveState?.(state)
  const reportConflicts = () => callbacks.onConflict?.([...conflicts.values()])

  const scheduleFlush = (fileId: string) => {
    clearTimer()
    timer = setTimeout(() => {
      void flushPending(fileId)
    }, DEBOUNCE_MS)
  }

  /**
   * 把 dirty 里的页逐页 CAS 出去。
   *
   * ⚠️ 写入在飞的时候用户还能继续画（画布没被挡住）——所以每一轮都取一份快照，
   * 只有「dirty 里还是我发出去的这一份」时才删；更新过的那份留在 dirty 里下一轮再发。
   * 直接 `dirty.delete(page)` 会安静地吞掉这笔：CAS 回来时把暂停期间画的新内容一起删了。
   */
  async function flushPending(fileId = currentFileId): Promise<boolean> {
    clearTimer()
    if (readOnly || dirty.size === 0) return true
    if (flushing) return false
    flushing = true
    setState('saving')

    let failed = false
    try {
      while (dirty.size > 0 && !failed) {
        let progressed = false
        for (const [page, strokes] of [...dirty.entries()]) {
          if (conflicts.has(page)) {
            dirty.delete(page)
            continue
          }
          const { data, error } = await supabase.rpc('push_shared_sheet_music_annotation', {
            p_file_id: fileId,
            p_page: page,
            p_strokes: strokes as never,
            p_expected_version: versions[page] ?? '',
          })
          if (error) {
            failed = true
            break
          }
          const row = (data as RpcRow[] | null)?.[0]
          if (!row) {
            failed = true
            break
          }
          progressed = true
          if (row.ok) {
            if (dirty.get(page) === strokes) dirty.delete(page)
            if (row.version) versions[page] = row.version
            baseDoc = { ...baseDoc, [String(page)]: strokes }
          } else {
            // CAS 冲突：不覆盖远端，交给冲突面板。
            // local 取**此刻**的内容（写入期间可能又画了新的一笔）
            const latest = dirty.get(page) ?? strokes
            dirty.delete(page)
            conflicts.set(page, {
              page,
              local: latest,
              remote: (Array.isArray(row.strokes) ? row.strokes : []) as AnnoStroke[],
              remoteVersion: row.version ?? '',
            })
            failed = true
            break
          }
        }
        // 这一轮一页都没动（剩下的全被冲突挡掉）：别空转
        if (!progressed) break
      }
    } finally {
      flushing = false
    }

    if (failed) {
      setState('error')
      reportConflicts()
      return false
    }
    if (dirty.size > 0) {
      // 写入期间又画了新内容：还没落完，别报「已保存」，按正常的停笔防抖再来一轮
      scheduleFlush(fileId)
      return false
    }
    setState(conflicts.size > 0 ? 'error' : 'saved')
    if (conflicts.size > 0) reportConflicts()
    return true
  }

  const backend: SharedAnnotationBackend = {
    kind: 'shared',
    get readOnly() {
      return readOnly
    },

    async load(fileId) {
      currentFileId = fileId
      baseDoc = {}
      versions = {}
      dirty = new Map()
      conflicts = new Map()
      clearTimer()

      const [annRes, permRes] = await Promise.all([
        supabase
          .from('sheet_music_shared_annotations')
          .select('page, strokes, version')
          .eq('file_id', fileId),
        supabase.rpc('can_edit_shared_annotation', { p_file_id: fileId }),
      ])

      const doc: AnnoDoc = {}
      if (!annRes.error) {
        for (const row of (annRes.data ?? []) as {
          page: number
          strokes: unknown
          version: string
        }[]) {
          doc[String(row.page)] = (Array.isArray(row.strokes) ? row.strokes : []) as AnnoStroke[]
          versions[row.page] = row.version
        }
      } else {
        console.error('[shared-annotation] 共享批注加载失败', annRes.error.message)
      }

      // 批注读取失败时不允许写：没有远端版本就无法做 CAS
      readOnly = !!annRes.error || !!permRes.error ? true : !permRes.data
      baseDoc = cloneDoc(doc)
      setState('saved')
      return doc
    },

    persist(fileId, doc) {
      if (readOnly) return
      for (const [key, strokes] of Object.entries(doc)) {
        const page = Number(key)
        if (!Number.isInteger(page) || page < 1) continue
        const pendingConflict = conflicts.get(page)
        if (pendingConflict) {
          // 冲突没解决之前不写这一页；但把「我现在的」更新进快照 —— 用户之后选
          // 「用我的」时要的是最后画成的那一版，不是冲突发生那一刻的
          conflicts.set(page, { ...pendingConflict, local: strokes })
          continue
        }
        if (pageFingerprint(strokes) === pageFingerprint(baseDoc[key] ?? [])) {
          dirty.delete(page)
        } else {
          dirty.set(page, strokes)
        }
      }
      if (dirty.size === 0) return
      setState('saving')
      scheduleFlush(fileId)
    },

    onClose() {
      void flushPending()
    },

    flush(fileId) {
      void flushPending(fileId)
    },

    retry() {
      void flushPending()
    },

    getConflict(page) {
      return conflicts.get(page)
    },

    flushNow() {
      return flushPending()
    },

    async resolveConflict(page, choice) {
      const conflict = conflicts.get(page)
      if (!conflict) return null
      const key = String(page)

      if (choice === 'remote') {
        conflicts.delete(page)
        dirty.delete(page)
        baseDoc = { ...baseDoc, [key]: conflict.remote }
        versions[page] = conflict.remoteVersion
        setState(conflicts.size > 0 ? 'error' : 'saved')
        reportConflicts()
        return conflict.remote
      }

      const next =
        choice === 'merge' ? mergeStrokes(conflict.local, conflict.remote) : conflict.local
      const { data, error } = await supabase.rpc('push_shared_sheet_music_annotation', {
        p_file_id: currentFileId,
        p_page: page,
        p_strokes: next as never,
        p_expected_version: conflict.remoteVersion,
      })
      const row = (data as RpcRow[] | null)?.[0]
      if (error || !row) {
        setState('error')
        return null
      }
      if (!row.ok) {
        // 解决期间又被别人改了：更新冲突快照，继续让用户选
        conflicts.set(page, {
          page,
          local: next,
          remote: (Array.isArray(row.strokes) ? row.strokes : []) as AnnoStroke[],
          remoteVersion: row.version ?? '',
        })
        setState('error')
        reportConflicts()
        return null
      }

      conflicts.delete(page)
      dirty.delete(page)
      baseDoc = { ...baseDoc, [key]: next }
      if (row.version) versions[page] = row.version
      setState(conflicts.size > 0 ? 'error' : 'saved')
      reportConflicts()
      return next
    },
  }

  return backend
}
