import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnnoDoc, AnnoStroke } from '@/lib/annotation'
import {
  applyMergePage,
  applySharedMerge,
  countNewStrokes,
  loadMergePage,
  loadMergePages,
  mergePageNumbers,
} from './shared-merge'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  loadAnnoDoc: vi.fn(),
  saveAnnoDoc: vi.fn(),
  markAnnoPending: vi.fn(),
  scheduleAnnotationSync: vi.fn(),
  currentUserId: vi.fn(),
  syncAnnotationFile: vi.fn(),
  loadConflictPages: vi.fn(),
  pageFingerprint: vi.fn((strokes: unknown) => JSON.stringify(strokes)),
  strokeKey: vi.fn((s: { color?: string; points?: unknown[] }) =>
    s?.points?.length ? JSON.stringify(s) : null
  ),
  mergeStrokes: vi.fn((a: unknown[], b: unknown[]) => [...a, ...b]),
}))

vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }))
vi.mock('@/lib/annotation', () => ({
  loadAnnoDoc: mocks.loadAnnoDoc,
  saveAnnoDoc: mocks.saveAnnoDoc,
}))
vi.mock('@/lib/annotation-sync', () => ({
  markAnnoPending: mocks.markAnnoPending,
  mergeStrokes: mocks.mergeStrokes,
  pageFingerprint: mocks.pageFingerprint,
  strokeKey: mocks.strokeKey,
}))
vi.mock('@/lib/annotation-sync-runner', () => ({
  currentUserId: mocks.currentUserId,
  syncAnnotationFile: mocks.syncAnnotationFile,
  loadConflictPages: mocks.loadConflictPages,
  scheduleAnnotationSync: mocks.scheduleAnnotationSync,
}))

const stroke = (color: string): AnnoStroke => ({
  color,
  width: 0.004,
  points: [[0.1, 0.2]],
})

const doc = (pages: Record<string, AnnoStroke[]>): AnnoDoc => pages

let sharedList: { data: unknown; error: unknown }
let sharedSingle: { data: unknown; error: unknown }

/** 视图查询链：`.eq('file_id')` 之后既可以 await（列表），也可以继续 `.eq('page').maybeSingle()` */
const query = () => ({
  select: () => ({
    eq: () => ({
      // 列表路径：await 这个对象
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(sharedList).then(resolve),
      // 单页路径：再 eq 一次
      eq: () => ({ maybeSingle: () => Promise.resolve(sharedSingle) }),
    }),
  }),
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.currentUserId.mockResolvedValue('u1')
  mocks.syncAnnotationFile.mockResolvedValue({ status: 'ok', pushed: 0, adopted: 0, conflicts: 0 })
  mocks.loadConflictPages.mockResolvedValue([])
  mocks.loadAnnoDoc.mockReturnValue({})
  mocks.saveAnnoDoc.mockReturnValue(true)
  sharedList = { data: [], error: null }
  sharedSingle = { data: null, error: null }
  mocks.from.mockImplementation(() => query())
  mocks.rpc.mockResolvedValue({ data: [{ ok: true, version: 'v2', strokes: null }], error: null })
})

describe('mergePageNumbers', () => {
  it('只列两侧指纹不同、且至少一侧有笔迹的页', () => {
    const personal = doc({ '1': [stroke('a')], '2': [], '3': [stroke('same')] })
    const shared = new Map<number, AnnoStroke[]>([
      [1, [stroke('b')]],
      [2, [stroke('only-shared')]],
      [3, [stroke('same')]],
      [4, []],
    ])

    expect(mergePageNumbers(personal, shared)).toEqual([1, 2])
  })
})

describe('countNewStrokes', () => {
  it('多重集差：已存在的同一笔不重复计数', () => {
    const a = stroke('a')
    const b = stroke('b')
    expect(countNewStrokes([a], [a, b])).toBe(1)
    expect(countNewStrokes([a], [b])).toBe(1)
    expect(countNewStrokes([a], [a])).toBe(0)
  })
})

describe('loadMergePages', () => {
  it('未登录 ⇒ no-user', async () => {
    mocks.currentUserId.mockResolvedValue(null)
    await expect(loadMergePages('f1', 'to-personal')).resolves.toEqual({
      ok: false,
      reason: 'no-user',
    })
  })

  it('个人同步失败 ⇒ sync-failed', async () => {
    mocks.syncAnnotationFile.mockResolvedValue({
      status: 'failed',
      pushed: 0,
      adopted: 0,
      conflicts: 0,
    })
    await expect(loadMergePages('f1', 'to-personal')).resolves.toEqual({
      ok: false,
      reason: 'sync-failed',
    })
  })

  it('共享→个人：个人冲突未解决 ⇒ personal-conflicts + 页列表', async () => {
    mocks.loadConflictPages.mockResolvedValue([3, 7])
    await expect(loadMergePages('f1', 'to-personal')).resolves.toEqual({
      ok: false,
      reason: 'personal-conflicts',
      pages: [3, 7],
    })
  })

  it('共享→个人：算出差异页', async () => {
    mocks.loadAnnoDoc.mockReturnValue(doc({ '1': [stroke('a')] }))
    sharedList = { data: [{ page: 1, strokes: [stroke('b')], version: 'v1' }], error: null }
    await expect(loadMergePages('f1', 'to-personal')).resolves.toEqual({ ok: true, pages: [1] })
  })

  it('个人→共享：没有写权 ⇒ not-allowed', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null })
    await expect(loadMergePages('f1', 'to-shared')).resolves.toEqual({
      ok: false,
      reason: 'not-allowed',
    })
  })

  it('个人→共享：有写权 ⇒ 正常算页', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null })
    mocks.loadAnnoDoc.mockReturnValue(doc({ '1': [stroke('a')] }))
    sharedList = { data: [], error: null }
    await expect(loadMergePages('f1', 'to-shared')).resolves.toEqual({ ok: true, pages: [1] })
  })
})

describe('loadMergePage', () => {
  it('取个人页 + 共享页 + 共享版本', async () => {
    mocks.loadAnnoDoc.mockReturnValue(doc({ '2': [stroke('mine')] }))
    sharedSingle = { data: { strokes: [stroke('theirs')], version: 'v2' }, error: null }
    await expect(loadMergePage('f1', 2)).resolves.toEqual({
      personal: [stroke('mine')],
      shared: [stroke('theirs')],
      sharedVersion: 'v2',
    })
    expect(mocks.from).toHaveBeenCalledWith('sheet_music_shared_annotations')
  })
})

describe('applyMergePage（共享 → 个人）', () => {
  it('local：什么都不写', async () => {
    const preview = { personal: [stroke('a')], shared: [stroke('b')], sharedVersion: null }
    mocks.loadAnnoDoc.mockReturnValue(doc({ '1': preview.personal }))
    await expect(
      applyMergePage({ fileId: 'f1', page: 1, direction: 'to-personal', choice: 'local', preview })
    ).resolves.toEqual({ ok: true, changed: false, addedStrokes: 0 })
    expect(mocks.saveAnnoDoc).not.toHaveBeenCalled()
  })

  it('shared：覆盖个人页并记欠账、起同步', async () => {
    const preview = { personal: [stroke('a')], shared: [stroke('b')], sharedVersion: null }
    mocks.loadAnnoDoc.mockReturnValue(doc({ '1': preview.personal }))
    await expect(
      applyMergePage({ fileId: 'f1', page: 1, direction: 'to-personal', choice: 'shared', preview })
    ).resolves.toEqual({ ok: true, changed: true, addedStrokes: 1 })
    expect(mocks.saveAnnoDoc).toHaveBeenCalledWith('u1', 'f1', { '1': [stroke('b')] })
    expect(mocks.markAnnoPending).toHaveBeenCalledWith('u1')
    expect(mocks.scheduleAnnotationSync).toHaveBeenCalledWith('f1')
  })

  it('merge：并集写回个人页', async () => {
    const preview = { personal: [stroke('a')], shared: [stroke('b')], sharedVersion: null }
    mocks.loadAnnoDoc.mockReturnValue(doc({ '1': preview.personal }))
    await expect(
      applyMergePage({ fileId: 'f1', page: 1, direction: 'to-personal', choice: 'merge', preview })
    ).resolves.toEqual({ ok: true, changed: true, addedStrokes: 1 })
    expect(mocks.saveAnnoDoc).toHaveBeenCalledWith('u1', 'f1', {
      '1': [stroke('a'), stroke('b')],
    })
  })

  it('预览之后个人页被后台同步改过 ⇒ raced，不写', async () => {
    const preview = { personal: [stroke('a')], shared: [stroke('b')], sharedVersion: null }
    mocks.loadAnnoDoc.mockReturnValue(doc({ '1': [stroke('changed')] }))
    await expect(
      applyMergePage({ fileId: 'f1', page: 1, direction: 'to-personal', choice: 'shared', preview })
    ).resolves.toEqual({ ok: false, reason: 'raced' })
    expect(mocks.saveAnnoDoc).not.toHaveBeenCalled()
  })

  it('写盘失败 ⇒ failed，不记欠账', async () => {
    const preview = { personal: [stroke('a')], shared: [stroke('b')], sharedVersion: null }
    mocks.loadAnnoDoc.mockReturnValue(doc({ '1': preview.personal }))
    mocks.saveAnnoDoc.mockReturnValue(false)
    await expect(
      applyMergePage({ fileId: 'f1', page: 1, direction: 'to-personal', choice: 'shared', preview })
    ).resolves.toEqual({ ok: false, reason: 'failed' })
    expect(mocks.markAnnoPending).not.toHaveBeenCalled()
  })
})

describe('applyMergePage（个人 → 共享）', () => {
  it('shared：保留共享版 ⇒ 不写', async () => {
    const preview = { personal: [stroke('a')], shared: [stroke('b')], sharedVersion: 'v1' }
    mocks.loadAnnoDoc.mockReturnValue(doc({ '1': preview.personal }))
    await expect(
      applyMergePage({ fileId: 'f1', page: 1, direction: 'to-shared', choice: 'shared', preview })
    ).resolves.toEqual({ ok: true, changed: false, addedStrokes: 0 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('local：以预览时的共享版本做 CAS', async () => {
    const preview = { personal: [stroke('a')], shared: [stroke('b')], sharedVersion: 'v1' }
    mocks.loadAnnoDoc.mockReturnValue(doc({ '1': preview.personal }))
    await expect(
      applyMergePage({ fileId: 'f1', page: 1, direction: 'to-shared', choice: 'local', preview })
    ).resolves.toEqual({ ok: true, changed: true, addedStrokes: 1 })
    expect(mocks.rpc).toHaveBeenCalledWith('push_shared_sheet_music_annotation', {
      p_file_id: 'f1',
      p_page: 1,
      p_strokes: [stroke('a')],
      p_expected_version: 'v1',
    })
    // 共享方向不写个人层
    expect(mocks.saveAnnoDoc).not.toHaveBeenCalled()
  })

  it('新页（共享无行）：期望版本是空串', async () => {
    const preview = { personal: [stroke('a')], shared: [], sharedVersion: null }
    mocks.loadAnnoDoc.mockReturnValue(doc({ '1': preview.personal }))
    await applyMergePage({
      fileId: 'f1',
      page: 1,
      direction: 'to-shared',
      choice: 'local',
      preview,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('push_shared_sheet_music_annotation', {
      p_file_id: 'f1',
      p_page: 1,
      p_strokes: [stroke('a')],
      p_expected_version: '',
    })
  })

  it('CAS 冲突 ⇒ raced，不覆盖', async () => {
    const preview = { personal: [stroke('a')], shared: [stroke('b')], sharedVersion: 'v1' }
    mocks.loadAnnoDoc.mockReturnValue(doc({ '1': preview.personal }))
    mocks.rpc.mockResolvedValue({
      data: [{ ok: false, version: 'v9', strokes: [stroke('other')] }],
      error: null,
    })
    await expect(
      applyMergePage({ fileId: 'f1', page: 1, direction: 'to-shared', choice: 'merge', preview })
    ).resolves.toEqual({ ok: false, reason: 'raced' })
  })

  it('RPC 报错 ⇒ failed', async () => {
    const preview = { personal: [stroke('a')], shared: [], sharedVersion: null }
    mocks.loadAnnoDoc.mockReturnValue(doc({ '1': preview.personal }))
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'net' } })
    await expect(
      applyMergePage({ fileId: 'f1', page: 1, direction: 'to-shared', choice: 'local', preview })
    ).resolves.toEqual({ ok: false, reason: 'failed' })
  })

  it('个人页在预览后变了 ⇒ raced，连 CAS 都不发', async () => {
    const preview = { personal: [stroke('a')], shared: [], sharedVersion: null }
    mocks.loadAnnoDoc.mockReturnValue(doc({ '1': [stroke('changed')] }))
    await expect(
      applyMergePage({ fileId: 'f1', page: 1, direction: 'to-shared', choice: 'local', preview })
    ).resolves.toEqual({ ok: false, reason: 'raced' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})

describe('applySharedMerge（批量契约）', () => {
  it('逐页应用，统计 appliedPages / addedStrokes', async () => {
    const a = stroke('a')
    const b = stroke('b')
    mocks.loadAnnoDoc.mockReturnValue(doc({ '1': [a], '2': [a] }))
    mocks.loadAnnoDoc.mockImplementation((_owner: string, _fileId: string) =>
      doc({ '1': [a], '2': [a] })
    )
    // 单页预览：1 页共享有 b，2 页共享与个人相同
    mocks.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          eq: (_col: string, page: number) => ({
            maybeSingle: () =>
              Promise.resolve(
                page === 1
                  ? { data: { strokes: [b], version: 'v1' }, error: null }
                  : { data: { strokes: [a], version: 'v2' }, error: null }
              ),
          }),
        }),
      }),
    }))

    const res = await applySharedMerge('f1', { 1: 'merge', 2: 'local' })
    expect(res.ok).toBe(true)
    expect(res.appliedPages).toBe(1)
    expect(res.addedStrokes).toBe(1)
  })
})
