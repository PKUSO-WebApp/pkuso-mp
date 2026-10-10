import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadAnnoDoc, saveAnnoDoc, type AnnoDoc, type AnnoStroke } from './annotation'
import { isAnnoPending, loadSyncBase, markAnnoPending, pageFingerprint, saveSyncBase } from './annotation-sync'
import type { RemotePage } from './annotation-sync'
import {
  flushAnnotationSync,
  scheduleAnnotationSync,
  setAnnotationAdoptListener,
  syncAllAnnotationFiles,
  syncAnnotationFile,
} from './annotation-sync-runner'

// 值保留原始类型：小程序 Storage 存布尔就取回布尔（存成字符串会让 isAnnoPending 永远为假）
const storage = new Map<string, unknown>()

// vi.mock 的工厂会被提升到 import 之前，工厂里引用的东西必须走 vi.hoisted（否则是 TDZ）
const { state, reports } = vi.hoisted(() => ({
  state: {
    userId: 'u1' as string | null,
    rows: [] as RemotePage[],
    selectError: null as string | null,
    selectCalls: 0,
    upsertCalls: [] as Array<{ file_id: string; user_id: string; page: number; strokes: unknown }>,
    upsertFailFor: new Set<number>(),
  },
  reports: [] as Array<{ event: string; message: string }>,
}))

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
    from: () => ({
      select: () => ({
        eq: async () => {
          state.selectCalls++
          return state.selectError
            ? { data: null, error: { message: state.selectError } }
            : { data: state.rows, error: null }
        },
      }),
      upsert: async (row: { file_id: string; user_id: string; page: number; strokes: unknown }) => {
        state.upsertCalls.push(row)
        return state.upsertFailFor.has(row.page) ? { error: { message: 'boom' } } : { error: null }
      },
    }),
  },
}))

vi.mock('@/lib/error-report', () => ({
  reportClientError: (input: { event: string; message: string }) => {
    reports.push({ event: input.event, message: input.message })
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
const docWith = (pages: Record<string, AnnoStroke[]>): AnnoDoc => pages
const remoteRow = (page: number, strokes: AnnoStroke[]): RemotePage => ({ page, strokes })

const seeded = (fileId: string, doc: AnnoDoc) => {
  saveAnnoDoc(fileId, doc)
}
/** 把基线写成「这一页的远端内容与本地一致」，模拟「上次同步成功过」 */
const seedBase = (fileId: string, doc: AnnoDoc) => {
  const base: Record<string, string> = {}
  for (const [page, strokes] of Object.entries(doc)) base[page] = pageFingerprint(strokes)
  saveSyncBase(fileId, 'u1', base)
}

beforeEach(() => {
  storage.clear()
  state.userId = 'u1'
  state.rows = []
  state.selectError = null
  state.selectCalls = 0
  state.upsertCalls = []
  state.upsertFailFor = new Set()
  reports.length = 0
  setAnnotationAdoptListener(null)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('syncAnnotationFile：先拉后推', () => {
  it('本地有内容、远端没有 ⇒ 推上去，并把基线推到当前指纹', async () => {
    const local = docWith({ '1': [stroke(0.1)] })
    seeded('f1', local)

    const result = await syncAnnotationFile('f1')

    expect(result).toEqual({ status: 'ok', pushed: 1, adopted: 0, conflicts: 0 })
    expect(state.upsertCalls).toHaveLength(1)
    expect(state.upsertCalls[0]).toMatchObject({ file_id: 'f1', user_id: 'u1', page: 1 })
    expect(loadSyncBase('f1', 'u1')).toEqual({ '1': pageFingerprint(local['1']) })
  })

  it('推过之后再同步一次：基线对得上，一个请求都不多发', async () => {
    seeded('f1', docWith({ '1': [stroke(0.1)] }))
    await syncAnnotationFile('f1')
    state.upsertCalls = []

    const again = await syncAnnotationFile('f1')

    expect(again.pushed).toBe(0)
    expect(state.upsertCalls).toEqual([])
  })

  it('远端改过、本地没动 ⇒ 落回本地，并通知阅读器刷新内存态', async () => {
    const mine = [stroke(0.1)]
    const theirs = [stroke(0.9)]
    seeded('f1', docWith({ '1': mine }))
    seedBase('f1', docWith({ '1': mine }))
    state.rows = [remoteRow(1, theirs)]

    const seen: AnnoDoc[] = []
    setAnnotationAdoptListener((id, doc) => {
      if (id === 'f1') seen.push(doc)
    })

    const result = await syncAnnotationFile('f1')

    expect(result).toEqual({ status: 'ok', pushed: 0, adopted: 1, conflicts: 0 })
    expect(loadAnnoDoc('f1')['1']).toEqual(theirs)
    expect(seen).toHaveLength(1)
    expect(seen[0]['1']).toEqual(theirs)
    expect(state.upsertCalls).toEqual([])
    expect(loadSyncBase('f1', 'u1')['1']).toBe(pageFingerprint(theirs))
  })

  it('两边都改过 ⇒ 冲突：不上传、不覆盖，只上报一条', async () => {
    const base = [stroke(0.5)]
    const mine = [stroke(0.1)]
    const theirs = [stroke(0.9)]
    seeded('f1', docWith({ '1': mine }))
    seedBase('f1', docWith({ '1': base }))
    state.rows = [remoteRow(1, theirs)]

    let adopted: AnnoDoc | null = null
    setAnnotationAdoptListener((_id, doc) => {
      adopted = doc
    })

    const result = await syncAnnotationFile('f1')

    expect(result.conflicts).toBe(1)
    expect(result.pushed).toBe(0)
    expect(state.upsertCalls).toEqual([])
    expect(loadAnnoDoc('f1')['1']).toEqual(mine) // 本地原样
    expect(adopted).toBeNull() // 没有 adopt 通路被触发
    // 冲突页的基线**不动**：它仍是旧基线，所以下次还能认出来
    expect(loadSyncBase('f1', 'u1')['1']).toBe(pageFingerprint(base))
    expect(reports.some((r) => r.event === 'score_reader_annotation_conflict')).toBe(true)
  })

  it('推送失败 ⇒ 留账：基线不推进、如实回 failed，再同步一次会重推', async () => {
    seeded('f1', docWith({ '1': [stroke(0.1)] }))
    state.upsertFailFor = new Set([1])

    const failed = await syncAnnotationFile('f1')

    expect(failed.status).toBe('failed')
    expect(loadSyncBase('f1', 'u1')).toEqual({})
    expect(reports.some((r) => r.event === 'score_reader_annotation_push_failed')).toBe(true)

    // 「进程被杀后重启」的等价物：这里没有任何内存态参与判定，靠的全是 Storage
    state.upsertFailFor = new Set()
    state.upsertCalls = []
    const retry = await syncAnnotationFile('f1')

    expect(retry.pushed).toBe(1)
    expect(state.upsertCalls).toHaveLength(1)
  })

  it('推到一半失败：成功的页要记住，失败的页下次再来', async () => {
    seeded('f1', docWith({ '1': [stroke(0.1)], '2': [stroke(0.2)] }))
    state.upsertFailFor = new Set([2])

    const result = await syncAnnotationFile('f1')

    expect(result.status).toBe('failed')
    expect(result.pushed).toBe(1)
    expect(loadSyncBase('f1', 'u1')).toEqual({ '1': pageFingerprint([stroke(0.1)]) })

    state.upsertFailFor = new Set()
    state.upsertCalls = []
    await syncAnnotationFile('f1')

    expect(state.upsertCalls.map((c) => c.page)).toEqual([2])
  })

  it('没登录 ⇒ 跳过，不发任何请求', async () => {
    state.userId = null
    seeded('f1', docWith({ '1': [stroke(0.1)] }))

    expect(await syncAnnotationFile('f1')).toEqual({ status: 'skipped', pushed: 0, adopted: 0, conflicts: 0 })
    expect(state.selectCalls).toBe(0)
    expect(state.upsertCalls).toEqual([])
  })

  it('拉取失败 ⇒ failed，且不写坏基线', async () => {
    state.selectError = 'network down'
    seeded('f1', docWith({ '1': [stroke(0.1)] }))

    const result = await syncAnnotationFile('f1')

    expect(result.status).toBe('failed')
    expect(loadSyncBase('f1', 'u1')).toEqual({})
    expect(state.upsertCalls).toEqual([])
    expect(reports.some((r) => r.event === 'score_reader_annotation_pull_failed')).toBe(true)
  })

  it('同一册并发调用只跑一次（防抖与联网恢复撞在一起时）', async () => {
    seeded('f1', docWith({ '1': [stroke(0.1)] }))

    const [a, b] = await Promise.all([syncAnnotationFile('f1'), syncAnnotationFile('f1')])

    expect([a.status, b.status].sort()).toEqual(['ok', 'skipped'])
    expect(state.upsertCalls).toHaveLength(1)
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
    seeded('f1', docWith({ '1': [stroke(0.1)] }))

    await syncAllAnnotationFiles()

    expect(state.selectCalls).toBe(0)
  })

  it('有欠账时扫**所有**有批注的册（不只当前那一册），全对上了才清标记', async () => {
    seeded('f1', docWith({ '1': [stroke(0.1)] }))
    seeded('f2', docWith({ '1': [stroke(0.2)] }))
    seeded('f3', docWith({ '2': [stroke(0.3)] }))
    markAnnoPending()

    await syncAllAnnotationFiles()

    expect(state.upsertCalls.map((c) => c.file_id).sort()).toEqual(['f1', 'f2', 'f3'])
    expect(isAnnoPending()).toBe(false)
  })

  it('有一册失败 ⇒ **不清**全局标记（宁可多扫一次，不能漏掉真欠账）', async () => {
    seeded('f1', docWith({ '1': [stroke(0.1)] }))
    seeded('f2', docWith({ '1': [stroke(0.2)] }))
    state.upsertFailFor = new Set([1])
    markAnnoPending()

    await syncAllAnnotationFiles()

    expect(isAnnoPending()).toBe(true)
  })
})

describe('触发点', () => {
  it('① 停笔防抖：连续改多次只在停下 2.5 秒后推一次', async () => {
    vi.useFakeTimers()
    seeded('f1', docWith({ '1': [stroke(0.1)] }))

    scheduleAnnotationSync('f1')
    await vi.advanceTimersByTimeAsync(1000)
    scheduleAnnotationSync('f1')
    await vi.advanceTimersByTimeAsync(1000)
    scheduleAnnotationSync('f1')
    expect(state.selectCalls).toBe(0)

    // 推进到「最后一次调度 + 防抖时长」之外：要是前两次的计时器没被取消，这里会打出去三次
    await vi.advanceTimersByTimeAsync(6000)
    expect(state.selectCalls).toBe(1)
    expect(state.upsertCalls).toHaveLength(1)
  })

  it('② 离开阅读器：flush 把挂着的那次防抖立刻发掉', async () => {
    vi.useFakeTimers()
    seeded('f1', docWith({ '1': [stroke(0.1)] }))

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
