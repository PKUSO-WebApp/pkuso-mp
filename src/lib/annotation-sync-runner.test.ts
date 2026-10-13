import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  compactStroke,
  loadAnnoDoc,
  saveAnnoDoc,
  type AnnoDoc,
  type AnnoStroke,
} from './annotation'
import {
  isAnnoPending,
  loadConflicts,
  loadSyncBase,
  markAnnoPending,
  pageFingerprint,
  saveConflicts,
  saveSyncBase,
  type BaseEntry,
  type SyncBase,
} from './annotation-sync'
import {
  __resetAnnotationSyncState,
  flushAnnotationSync,
  loadConflictPage,
  resolveAnnotationConflict,
  scheduleAnnotationSync,
  setAnnotationAdoptListener,
  setAnnotationConflictListener,
  syncAllAnnotationFiles,
  syncAnnotationFile,
} from './annotation-sync-runner'

// 值保留原始类型：小程序 Storage 存布尔就取回布尔（存成字符串会让 isAnnoPending 永远为假）
const storage = new Map<string, unknown>()

/**
 * 假服务端。
 *
 * ⚠️ 它只是**契约的影子**：CAS 的真正语义（行锁、并发插入、生成列、历史归档）
 * 在 pkuso-backend 的 migration 里，用一次性 postgres 容器验过（19 条断言）。
 * 这里实现的是**客户端依赖的那几条**：期望值对不上就拒绝、并把远端当前内容带回来。
 * 夹具形状必须是**数据库行**（`updated_at` 是 ISO 字符串、`strokes` 是 JSON），
 * 不是映射后的样子——本仓栽过这类夹具空转。
 */
const { state, reports } = vi.hoisted(() => ({
  state: {
    userId: 'u1' as string | null,
    rows: [] as Array<{
      file_id: string
      page: number
      strokes: unknown
      version: string | null
      updated_at: string
    }>,
    selectError: null as string | null,
    selectCalls: 0,
    pushCalls: [] as Array<{
      p_file_id: string
      p_page: number
      p_expected_version?: string
      p_strokes: unknown
    }>,
    archiveCalls: [] as Array<{ p_page: number; p_strokes: unknown }>,
    /** 让这一页的 rpc 直接报错（模拟网络失败） */
    failPushFor: new Set<number>(),
    archiveError: null as string | null,
    /** 覆盖推送的应答（模拟丢 ACK / 并发写：服务端已经写进去了，客户端却看到「冲突」） */
    pushReply: null as
      | null
      | ((args: {
          p_file_id: string
          p_page: number
          p_expected_version?: string
          p_strokes: unknown
        }) => { ok: boolean; version: string | null; strokes: unknown }),
    versionSeq: 0,
  },
  reports: [] as Array<{ event: string; message: string; detail?: unknown }>,
}))

/** 服务端那一页的 CAS 写入（返回契约里那三列） */
function serverPush(args: {
  p_file_id: string
  p_page: number
  p_expected_version?: string
  p_strokes: unknown
}) {
  const row = state.rows.find((r) => r.file_id === args.p_file_id && r.page === args.p_page)
  const expected = args.p_expected_version
  if (expected !== undefined) {
    const hit = expected === '' ? !row : Boolean(row && row.version === expected)
    if (!hit) {
      return { ok: false, version: row?.version ?? null, strokes: row?.strokes ?? null }
    }
  }
  const version = `v${++state.versionSeq}`
  if (row) {
    row.strokes = args.p_strokes
    row.version = version
  } else {
    state.rows.push({
      file_id: args.p_file_id,
      page: args.p_page,
      strokes: args.p_strokes,
      version,
      updated_at: new Date().toISOString(),
    })
  }
  return { ok: true, version, strokes: null }
}

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: (key: string) => storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => {
      storage.set(key, value)
    },
    removeStorageSync: (key: string) => {
      storage.delete(key)
    },
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    onNetworkStatusChange: vi.fn(),
  },
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: state.userId ? { user: { id: state.userId } } : null },
      }),
    },
    from: () => {
      let fileFilter: string | null = null
      let pageFilter: number | null = null
      const pick = () =>
        state.rows.filter(
          (r) =>
            (fileFilter === null || r.file_id === fileFilter) &&
            (pageFilter === null || r.page === pageFilter)
        )
      const query = {
        select: () => query,
        eq: (col: string, val: unknown) => {
          if (col === 'file_id') fileFilter = String(val)
          if (col === 'page') pageFilter = Number(val)
          return query
        },
        maybeSingle: async () => {
          state.selectCalls++
          if (state.selectError) return { data: null, error: { message: state.selectError } }
          return { data: pick()[0] ?? null, error: null }
        },
        // 让 `await ...select().eq()`（不接 maybeSingle 的那条）也能取到结果
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          state.selectCalls++
          return Promise.resolve(
            state.selectError
              ? { data: null, error: { message: state.selectError } }
              : { data: pick(), error: null }
          ).then(resolve, reject)
        },
      }
      return query
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'push_sheet_music_annotation') {
        const a = args as {
          p_file_id: string
          p_page: number
          p_expected_version?: string
          p_strokes: unknown
        }
        state.pushCalls.push(a)
        if (state.failPushFor.has(a.p_page)) return { data: null, error: { message: 'boom' } }
        const reply = state.pushReply ? state.pushReply(a) : serverPush(a)
        return { data: [reply], error: null }
      }
      if (name === 'archive_sheet_music_annotation') {
        state.archiveCalls.push(args as { p_page: number; p_strokes: unknown })
        return state.archiveError
          ? { data: null, error: { message: state.archiveError } }
          : { data: null, error: null }
      }
      return { data: null, error: { message: `unknown rpc ${name}` } }
    },
  },
}))

vi.mock('@/lib/error-report', () => ({
  reportClientError: (input: { event: string; message: string; detail?: unknown }) => {
    reports.push({ event: input.event, message: input.message, detail: input.detail })
  },
}))

const stroke = (x: number): AnnoStroke => ({
  color: '#e5484d',
  width: 0.004,
  points: [
    [x, 0.5],
    [x + 0.1, 0.5],
  ],
})
/**
 * 笔迹落盘会被 `compactStroke` 归一化（4 位小数、近重复点）⇒ 断言「读回来的内容」时要拿
 * 归一化后的形状比。用未归一化的字面量比会因为 `0.2 + 0.1 = 0.30000000000000004` 这类
 * 浮点尾数而假红——**那是测试的错，不是代码的错**。
 */
const packed = (strokes: AnnoStroke[]): AnnoStroke[] => strokes.map(compactStroke)
const docWith = (pages: Record<string, AnnoStroke[]>): AnnoDoc => pages
/** 服务端已有这一页（内容 + 版本），`updated_at` 是 ISO 串（数据库行的形状） */
const seedRemote = (page: number, strokes: AnnoStroke[], version = `r${page}`, fileId = 'f1') => {
  state.rows.push({
    file_id: fileId,
    page,
    strokes,
    version,
    updated_at: new Date(0).toISOString(),
  })
  return version
}
const setted = (fileId: string, doc: AnnoDoc) => {
  saveAnnoDoc(fileId, doc)
}
/** 基线 = 「上次同步成功时这一页长这样」（带服务端版本） */
const seedBase = (fileId: string, entries: Record<string, BaseEntry>) => {
  saveSyncBase(fileId, 'u1', entries as SyncBase)
}
const baseOf = (strokes: AnnoStroke[], version?: string): BaseEntry =>
  version === undefined
    ? { fp: pageFingerprint(strokes) }
    : { fp: pageFingerprint(strokes), version }

beforeEach(() => {
  storage.clear()
  state.userId = 'u1'
  state.rows = []
  state.selectError = null
  state.selectCalls = 0
  state.pushCalls = []
  state.archiveCalls = []
  state.failPushFor = new Set()
  state.archiveError = null
  state.pushReply = null
  state.versionSeq = 0
  reports.length = 0
  setAnnotationAdoptListener(null)
  setAnnotationConflictListener(null)
  __resetAnnotationSyncState()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('syncAnnotationFile：先拉后推（CAS）', () => {
  it('本地有内容、远端没有 ⇒ 推上去（expected = 空串），基线记住版本', async () => {
    const local = docWith({ '1': [stroke(0.1)] })
    setted('f1', local)

    const result = await syncAnnotationFile('f1')

    expect(result).toEqual({ status: 'ok', pushed: 1, adopted: 0, conflicts: 0 })
    expect(state.pushCalls).toHaveLength(1)
    expect(state.pushCalls[0].p_page).toBe(1)
    expect(state.pushCalls[0].p_expected_version).toBe('')
    expect(loadSyncBase('f1', 'u1')['1']).toEqual({
      fp: pageFingerprint(local['1']),
      version: state.rows[0].version,
    })
  })

  it('推过之后再同步一次：基线对得上，一个请求都不多发', async () => {
    setted('f1', docWith({ '1': [stroke(0.1)] }))
    await syncAnnotationFile('f1')
    state.pushCalls = []

    const again = await syncAnnotationFile('f1')

    expect(again.pushed).toBe(0)
    expect(state.pushCalls).toEqual([])
  })

  it('远端改过、本地没动 ⇒ 落回本地，并通知阅读器刷新内存态', async () => {
    const mine = [stroke(0.1)]
    const theirs = [stroke(0.9)]
    setted('f1', docWith({ '1': mine }))
    seedBase('f1', { '1': baseOf(mine, 'v1') })
    seedRemote(1, theirs, 'v2')

    const seen: AnnoDoc[] = []
    setAnnotationAdoptListener((id, doc) => {
      if (id === 'f1') seen.push(doc)
    })

    const result = await syncAnnotationFile('f1')

    expect(result).toEqual({ status: 'ok', pushed: 0, adopted: 1, conflicts: 0 })
    expect(loadAnnoDoc('f1')['1']).toEqual(theirs)
    expect(seen).toHaveLength(1)
    expect(seen[0]['1']).toEqual(theirs)
    expect(state.pushCalls).toEqual([])
    expect(loadSyncBase('f1', 'u1')['1']).toEqual({ fp: pageFingerprint(theirs), version: 'v2' })
  })

  it('⚠️ 两边都改、互不包含 ⇒ 冲突：不推不收、两边都不动，记进冲突记录并通知界面', async () => {
    const base = [stroke(0.5)]
    const mine = [stroke(0.1)]
    const theirs = [stroke(0.9)]
    setted('f1', docWith({ '1': mine }))
    seedBase('f1', { '1': baseOf(base, 'v1') })
    seedRemote(1, theirs, 'v2')

    const noticed: number[][] = []
    setAnnotationConflictListener((id, pages) => {
      if (id === 'f1') noticed.push(pages)
    })

    const result = await syncAnnotationFile('f1')

    expect(result.conflicts).toBe(1)
    expect(result.pushed).toBe(0)
    expect(state.pushCalls).toEqual([]) // 冲突页一个字节都不写
    expect(loadAnnoDoc('f1')['1']).toEqual(mine) // 本地原样
    expect(state.rows[0].strokes).toEqual(theirs) // 远端原样
    expect(loadConflicts('f1', 'u1')).toEqual([1])
    expect(noticed).toEqual([[1]])
    // 基线**不推进**：这一页在解决之前一直是冲突（而解决要靠用户选，不是靠时间）
    expect(loadSyncBase('f1', 'u1')['1']).toEqual(baseOf(base, 'v1'))
    expect(reports.some((r) => r.event === 'score_reader_annotation_conflict')).toBe(true)
  })

  it('⚠️ 包含关系：远端 ⊆ 本地 ⇒ 自动推（用刚读到的版本 CAS），不弹窗', async () => {
    // 基线是空页、两边都动过、而远端那份整个是我这份的子集
    const mine = [stroke(0.1), stroke(0.2)]
    setted('f1', docWith({ '1': mine }))
    seedBase('f1', { '1': baseOf([], 'v1') })
    seedRemote(1, [stroke(0.1)], 'v2')

    const result = await syncAnnotationFile('f1')

    expect(result).toEqual({ status: 'ok', pushed: 1, adopted: 0, conflicts: 0 })
    expect(state.pushCalls[0].p_expected_version).toBe('v2')
    expect(loadConflicts('f1', 'u1')).toEqual([])
  })

  it('⚠️ 包含关系：本地 ⊆ 远端 ⇒ 自动收下远端（本地那几笔远端都有）', async () => {
    const mine = [stroke(0.1)]
    setted('f1', docWith({ '1': mine }))
    seedBase('f1', { '1': baseOf([], 'v1') })
    const theirs = [stroke(0.1), stroke(0.2)]
    seedRemote(1, theirs, 'v2')

    const result = await syncAnnotationFile('f1')

    expect(result).toEqual({ status: 'ok', pushed: 0, adopted: 1, conflicts: 0 })
    expect(loadAnnoDoc('f1')['1']).toEqual(packed(theirs))
    expect(loadConflicts('f1', 'u1')).toEqual([])
    expect(state.pushCalls).toEqual([])
  })

  it('⚠️ 丢 ACK：CAS 落空但远端内容与我这份**一字不差** ⇒ 当成功，绝不报冲突', async () => {
    const base = [stroke(0.5)]
    const mine = [stroke(0.1)]
    setted('f1', docWith({ '1': mine }))
    seedBase('f1', { '1': baseOf(base, 'v1') })
    seedRemote(1, base, 'v1')
    // 服务端已经把我这份写进去了（响应丢了），于是这次推送看到「版本对不上 + 内容就是我这份」
    state.pushReply = () => ({ ok: false, version: 'v9', strokes: mine })

    const result = await syncAnnotationFile('f1')

    expect(result).toEqual({ status: 'ok', pushed: 1, adopted: 0, conflicts: 0 })
    expect(loadConflicts('f1', 'u1')).toEqual([])
    expect(loadSyncBase('f1', 'u1')['1']).toEqual({ fp: pageFingerprint(mine), version: 'v9' })
  })

  it('⚠️ CAS 落空且远端 ⊆ 本地 ⇒ 用拿到的版本重试一次（不打扰用户）', async () => {
    const base = [stroke(0.5)]
    const mine = [stroke(0.5), stroke(0.1), stroke(0.2)]
    setted('f1', docWith({ '1': mine }))
    seedBase('f1', { '1': baseOf(base, 'v1') })
    seedRemote(1, base, 'v1')
    // 第一次推送时远端已经变成「基线 + 其中一笔」，而它仍是我这份的子集
    let first = true
    state.pushReply = (args) => {
      if (first) {
        first = false
        state.rows[0].strokes = [stroke(0.5), stroke(0.1)]
        state.rows[0].version = 'v2'
        return { ok: false, version: 'v2', strokes: state.rows[0].strokes }
      }
      return serverPush(args)
    }

    const result = await syncAnnotationFile('f1')

    expect(result).toEqual({ status: 'ok', pushed: 1, adopted: 0, conflicts: 0 })
    expect(state.pushCalls).toHaveLength(2)
    expect(state.pushCalls[1].p_expected_version).toBe('v2')
    expect(loadConflicts('f1', 'u1')).toEqual([])
  })

  it('CAS 落空、互不包含 ⇒ 记成冲突（推的那一刻才发现的那种）', async () => {
    const base = [stroke(0.5)]
    const mine = [stroke(0.1)]
    setted('f1', docWith({ '1': mine }))
    seedBase('f1', { '1': baseOf(base, 'v1') })
    seedRemote(1, base, 'v1')
    state.pushReply = () => ({ ok: false, version: 'v2', strokes: [stroke(0.9)] })

    const result = await syncAnnotationFile('f1')

    expect(result.conflicts).toBe(1)
    expect(loadConflicts('f1', 'u1')).toEqual([1])
  })

  it('推送失败 ⇒ 留账：基线不推进、如实回 failed，再同步一次会重推', async () => {
    setted('f1', docWith({ '1': [stroke(0.1)] }))
    state.failPushFor = new Set([1])

    const failed = await syncAnnotationFile('f1')

    expect(failed.status).toBe('failed')
    expect(loadSyncBase('f1', 'u1')).toEqual({})
    expect(reports.some((r) => r.event === 'score_reader_annotation_push_failed')).toBe(true)

    // 「进程被杀后重启」的等价物：这里没有任何内存态参与判定，靠的全是 Storage
    state.failPushFor = new Set()
    state.pushCalls = []
    const retry = await syncAnnotationFile('f1')

    expect(retry.pushed).toBe(1)
    expect(state.pushCalls).toHaveLength(1)
  })

  it('推到一半失败：成功的页要记住，失败的页下次再来', async () => {
    setted('f1', docWith({ '1': [stroke(0.1)], '2': [stroke(0.2)] }))
    state.failPushFor = new Set([2])

    const result = await syncAnnotationFile('f1')

    expect(result.status).toBe('failed')
    expect(result.pushed).toBe(1)
    expect(Object.keys(loadSyncBase('f1', 'u1'))).toEqual(['1'])

    state.failPushFor = new Set()
    state.pushCalls = []
    await syncAnnotationFile('f1')

    expect(state.pushCalls.map((c) => c.p_page)).toEqual([2])
  })

  it('没登录 ⇒ 跳过，不发任何请求', async () => {
    state.userId = null
    setted('f1', docWith({ '1': [stroke(0.1)] }))

    expect(await syncAnnotationFile('f1')).toEqual({
      status: 'skipped',
      pushed: 0,
      adopted: 0,
      conflicts: 0,
    })
    expect(state.selectCalls).toBe(0)
    expect(state.pushCalls).toEqual([])
  })

  it('拉取失败 ⇒ failed、不写坏基线，而且**不动冲突记录**（这一次什么都没对成）', async () => {
    state.selectError = 'network down'
    setted('f1', docWith({ '1': [stroke(0.1)] }))
    saveConflicts('f1', 'u1', [3])

    const result = await syncAnnotationFile('f1')

    expect(result.status).toBe('failed')
    expect(loadSyncBase('f1', 'u1')).toEqual({})
    expect(state.pushCalls).toEqual([])
    expect(loadConflicts('f1', 'u1')).toEqual([3])
    expect(reports.some((r) => r.event === 'score_reader_annotation_pull_failed')).toBe(true)
  })

  it('⚠️ 冲突解决之后：记录被摘掉（对完账的记录整体重写，不会留下死记录）', async () => {
    const base = [stroke(0.5)]
    const mine = [stroke(0.1)]
    setted('f1', docWith({ '1': mine }))
    seedBase('f1', { '1': baseOf(base, 'v1') })
    seedRemote(1, [stroke(0.9)], 'v2')
    saveConflicts('f1', 'u1', [1, 5])

    await syncAnnotationFile('f1')
    expect(loadConflicts('f1', 'u1')).toEqual([1])

    // 用户在别处把这一页解决成了远端那一版 ⇒ 下一次同步自然就不冲突了
    state.rows[0].strokes = mine
    state.rows[0].version = 'v3'
    await syncAnnotationFile('f1')

    expect(loadConflicts('f1', 'u1')).toEqual([])
  })

  it('同一册并发调用只跑一次，且第二个调用拿到的是**同一次运行的结果**', async () => {
    setted('f1', docWith({ '1': [stroke(0.1)] }))

    const [a, b] = await Promise.all([syncAnnotationFile('f1'), syncAnnotationFile('f1')])

    expect(state.pushCalls).toHaveLength(1)
    expect(a).toEqual(b)
    expect(a.status).toBe('ok')
    expect(a.pushed).toBe(1)
  })
})

describe('syncAllAnnotationFiles', () => {
  /**
   * ⚠️ 扫描有 5 秒的最小间隔（模块级的 lastScanAt）。不推进时钟的话，同一批用例里
   * **第二次扫描会被静默跳过**——那样「有册失败就不清标记」这条即使实现写坏了也照样绿。
   */
  let clock = Date.now()
  beforeEach(() => {
    vi.useFakeTimers()
    clock += 60_000
    vi.setSystemTime(clock)
  })

  it('没欠账时一个请求都不发', async () => {
    setted('f1', docWith({ '1': [stroke(0.1)] }))

    await syncAllAnnotationFiles()

    expect(state.selectCalls).toBe(0)
  })

  it('有欠账时扫**所有**有批注的册（不只当前那一册），全对上了才清标记', async () => {
    setted('f1', docWith({ '1': [stroke(0.1)] }))
    setted('f2', docWith({ '1': [stroke(0.2)] }))
    setted('f3', docWith({ '2': [stroke(0.3)] }))
    markAnnoPending()

    await syncAllAnnotationFiles()

    expect(state.pushCalls).toHaveLength(3)
    expect(isAnnoPending()).toBe(false)
  })

  it('有一册失败 ⇒ **不清**全局标记（宁可多扫一次，不能漏掉真欠账）', async () => {
    setted('f1', docWith({ '1': [stroke(0.1)] }))
    setted('f2', docWith({ '1': [stroke(0.2)] }))
    state.failPushFor = new Set([1])
    markAnnoPending()

    await syncAllAnnotationFiles()

    expect(isAnnoPending()).toBe(true)
  })
})

describe('loadConflictPage / resolveAnnotationConflict', () => {
  const mine = [stroke(0.1)]
  const theirs = [stroke(0.9)]

  const seedConflict = (fileId = 'f1', page = 1) => {
    setted(fileId, docWith({ [String(page)]: mine }))
    seedRemote(page, theirs, 'v2')
    saveConflicts(fileId, 'u1', [page])
  }

  it('读一页的两份内容（本地 + 远端 + 远端版本）', async () => {
    seedConflict()

    const stateOf = await loadConflictPage('f1', 1)

    expect(stateOf.local).toEqual(mine)
    expect(stateOf.remote).toEqual(theirs)
    expect(stateOf.remoteVersion).toBe('v2')
    expect(stateOf.local).not.toBe(mine) // 从 Storage 读回来的，不是同一个引用
  })

  it('用本地版：CAS 推上去（期望值是**预览时看到的**远端版本），基线推进、冲突记录摘掉', async () => {
    seedConflict()
    const shown = await loadConflictPage('f1', 1)

    const result = await resolveAnnotationConflict({
      fileId: 'f1',
      page: 1,
      choice: 'local',
      shownVersion: shown.remoteVersion,
    })

    expect(result).toEqual({ ok: true })
    expect(state.pushCalls).toHaveLength(1)
    expect(state.pushCalls[0].p_expected_version).toBe('v2')
    expect(state.rows[0].strokes).toEqual(mine)
    expect(loadSyncBase('f1', 'u1')['1'].fp).toBe(pageFingerprint(mine))
    expect(loadConflicts('f1', 'u1')).toEqual([])
  })

  it('⚠️ 用远端版：**先把本地这份送进服务端历史**，再采纳远端', async () => {
    seedConflict()
    const shown = await loadConflictPage('f1', 1)

    const result = await resolveAnnotationConflict({
      fileId: 'f1',
      page: 1,
      choice: 'remote',
      shownVersion: shown.remoteVersion,
    })

    expect(result).toEqual({ ok: true })
    expect(state.archiveCalls).toHaveLength(1)
    expect(state.archiveCalls[0].p_strokes).toEqual(mine) // 保住的是**本地**那份
    expect(loadAnnoDoc('f1')['1']).toEqual(theirs)
    expect(loadSyncBase('f1', 'u1')['1']).toEqual({ fp: pageFingerprint(theirs), version: 'v2' })
    expect(loadConflicts('f1', 'u1')).toEqual([])
  })

  it('⚠️ 归档失败 ⇒ **不采纳**（宁可待会儿再试，也不能把本地那份弄丢）', async () => {
    seedConflict()
    state.archiveError = 'boom'

    const result = await resolveAnnotationConflict({
      fileId: 'f1',
      page: 1,
      choice: 'remote',
      shownVersion: 'v2',
    })

    expect(result).toEqual({ ok: false, reason: 'failed' })
    expect(loadAnnoDoc('f1')['1']).toEqual(mine)
    expect(loadConflicts('f1', 'u1')).toEqual([1])
  })

  it('⚠️ 远端在用户看预览时又变了 ⇒ 什么都不做、回 raced（不拿旧选择套新内容）', async () => {
    seedConflict()
    state.rows[0].version = 'v3'
    state.rows[0].strokes = [stroke(0.7)]

    const local = await resolveAnnotationConflict({
      fileId: 'f1',
      page: 1,
      choice: 'local',
      shownVersion: 'v2',
    })
    expect(local).toEqual({ ok: false, reason: 'raced' })

    const remote = await resolveAnnotationConflict({
      fileId: 'f1',
      page: 1,
      choice: 'remote',
      shownVersion: 'v2',
    })
    expect(remote).toEqual({ ok: false, reason: 'raced' })

    expect(state.pushCalls).toEqual([])
    expect(state.archiveCalls).toEqual([])
    expect(loadAnnoDoc('f1')['1']).toEqual(mine)
    expect(loadConflicts('f1', 'u1')).toEqual([1])
  })

  it('用本地版时 CAS 又落空（远端在我提交的瞬间变了）⇒ 报 raced，不静默覆盖', async () => {
    seedConflict()
    state.pushReply = () => ({ ok: false, version: 'v3', strokes: [stroke(0.7)] })

    const result = await resolveAnnotationConflict({
      fileId: 'f1',
      page: 1,
      choice: 'local',
      shownVersion: 'v2',
    })

    expect(result).toEqual({ ok: false, reason: 'raced' })
    expect(loadConflicts('f1', 'u1')).toEqual([1])
  })

  it('用本地版时 CAS 落空但远端内容就是我这份（丢 ACK）⇒ 当成功', async () => {
    seedConflict()
    state.pushReply = () => ({ ok: false, version: 'v9', strokes: mine })

    const result = await resolveAnnotationConflict({
      fileId: 'f1',
      page: 1,
      choice: 'local',
      shownVersion: 'v2',
    })

    expect(result).toEqual({ ok: true })
    expect(loadSyncBase('f1', 'u1')['1']).toEqual({ fp: pageFingerprint(mine), version: 'v9' })
  })

  it('本地那份与远端一字不差时不必归档（没有要保的东西）', async () => {
    setted('f1', docWith({ '1': theirs }))
    seedRemote(1, theirs, 'v2')
    saveConflicts('f1', 'u1', [1])

    const result = await resolveAnnotationConflict({
      fileId: 'f1',
      page: 1,
      choice: 'remote',
      shownVersion: 'v2',
    })

    expect(result).toEqual({ ok: true })
    expect(state.archiveCalls).toEqual([])
  })

  it('没登录 ⇒ no-user，什么都不做', async () => {
    seedConflict()
    state.userId = null

    expect(
      await resolveAnnotationConflict({
        fileId: 'f1',
        page: 1,
        choice: 'local',
        shownVersion: 'v2',
      })
    ).toEqual({ ok: false, reason: 'no-user' })
    expect(state.pushCalls).toEqual([])
  })
})

describe('触发点', () => {
  it('① 停笔防抖：连续改多次只在停下 2.5 秒后推一次', async () => {
    vi.useFakeTimers()
    setted('f1', docWith({ '1': [stroke(0.1)] }))

    scheduleAnnotationSync('f1')
    await vi.advanceTimersByTimeAsync(1000)
    scheduleAnnotationSync('f1')
    await vi.advanceTimersByTimeAsync(1000)
    scheduleAnnotationSync('f1')
    expect(state.selectCalls).toBe(0)

    // 推进到「最后一次调度 + 防抖时长」之外：要是前两次的计时器没被取消，这里会打出去三次
    await vi.advanceTimersByTimeAsync(6000)
    expect(state.selectCalls).toBe(1)
    expect(state.pushCalls).toHaveLength(1)
  })

  it('② 离开阅读器：flush 把挂着的那次防抖立刻发掉', async () => {
    vi.useFakeTimers()
    setted('f1', docWith({ '1': [stroke(0.1)] }))

    scheduleAnnotationSync('f1')
    expect(state.selectCalls).toBe(0)

    flushAnnotationSync('f1')
    await vi.advanceTimersByTimeAsync(0)
    expect(state.selectCalls).toBe(1)
    // 防抖计时器已被吃掉，再走过整个防抖窗口也不会发第二次
    await vi.advanceTimersByTimeAsync(6000)
    expect(state.selectCalls).toBe(1)
  })
})
