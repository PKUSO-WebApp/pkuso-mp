import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnnoDoc, AnnoStroke } from '@/lib/annotation'
import { pageFingerprint } from '@/lib/annotation-sync'
import { pullShareLayer, resolveSharePullConflict } from './share-pull'

const SHARE = 's1'
const OWNER = 'u1'
const DOC = 'share:s1'

const store = vi.hoisted(() => ({
  docs: new Map<string, AnnoDoc>(),
  storage: new Map<string, unknown>(),
  shareRows: [] as unknown[],
  versionRow: null as { version: string | null } | null,
  schedule: vi.fn(),
  archive: vi.fn(),
  saveFails: false,
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: (key: string) => store.storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => store.storage.set(key, value),
    removeStorageSync: (key: string) => store.storage.delete(key),
  },
}))

vi.mock('@/lib/annotation', () => ({
  // 本模块只关心「本地文档」这一层语义；真正的存储键规则由 annotation.test 钉
  loadAnnoDoc: (owner: string, key: string) => store.docs.get(`${owner}:${key}`) ?? {},
  saveAnnoDoc: (owner: string, key: string, doc: AnnoDoc) => {
    if (store.saveFails) return false
    store.docs.set(`${owner}:${key}`, doc)
    return true
  },
  annoStoragePrefix: (owner: string) => `score-annotation-v1:${owner}:`,
  compactStroke: (s: AnnoStroke) => s,
}))

vi.mock('@/lib/annotation-sync', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/annotation-sync')>('@/lib/annotation-sync')
  return { ...actual, markAnnoPending: vi.fn() }
})

vi.mock('@/lib/annotation-sync-runner', () => ({
  scheduleAnnotationSync: store.schedule,
}))

const supa = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: supa.from, rpc: supa.rpc },
}))

const stroke = (color: string): AnnoStroke => ({
  color,
  width: 0.004,
  points: [[0.1, 0.2]],
})

const remoteRow = (page: number, strokes: AnnoStroke[], version: string) => ({
  page,
  strokes,
  version,
  updated_at: new Date().toISOString(),
})

beforeEach(() => {
  vi.clearAllMocks()
  store.docs.clear()
  store.storage.clear()
  store.shareRows = []
  store.versionRow = null
  store.saveFails = false
  store.archive.mockResolvedValue({ data: null, error: null })

  // 两条查询形状：整册 select('page, strokes, version, updated_at') 是 thenable；
  // 单页 select('version') 走 maybeSingle（冲突提交前的版本复核）。
  supa.from.mockImplementation(() => ({
    select: (cols: string) => {
      if (cols === 'version') {
        const q: any = {
          eq: () => q,
          maybeSingle: () => Promise.resolve({ data: store.versionRow, error: null }),
        }
        return q
      }
      const q: any = {
        eq: () => q,
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          Promise.resolve({ data: store.shareRows, error: null }).then(resolve, reject),
      }
      return q
    },
  }))
  supa.rpc.mockResolvedValue({ data: null, error: null })
})

describe('pullShareLayer：打开共享副本时把共享层拉进个人层', () => {
  it('本地没动、共享层有内容 ⇒ 收下；基线推进；调度个人云同步', async () => {
    const remote = [stroke('red')]
    store.shareRows = [remoteRow(1, remote, 'v1')]

    const res = await pullShareLayer({ owner: OWNER, shareId: SHARE, docKey: DOC })

    expect(res.adopted).toEqual([1])
    expect(res.conflicts).toEqual([])
    expect(res.doc['1']).toEqual(remote)
    expect(store.docs.get(`${OWNER}:${DOC}`)?.['1']).toEqual(remote)
    expect(store.schedule).toHaveBeenCalledWith(DOC)
    const base = store.storage.get(`share-pull-base-v1:${OWNER}:${SHARE}`) as Record<
      string,
      { fp: string; version?: string }
    >
    expect(base['1']).toEqual({ fp: pageFingerprint(remote), version: 'v1' })
  })

  it('两边都动过且互不包含 ⇒ 冲突，不改本地、不推进该页基线', async () => {
    const local = [stroke('blue')]
    const remote = [stroke('red')]
    store.docs.set(`${OWNER}:${DOC}`, { '1': local })
    store.shareRows = [remoteRow(1, remote, 'v1')]

    const res = await pullShareLayer({ owner: OWNER, shareId: SHARE, docKey: DOC })

    expect(res.adopted).toEqual([])
    expect(res.conflicts).toHaveLength(1)
    expect(res.conflicts[0]).toMatchObject({ page: 1, local, remote, remoteVersion: 'v1' })
    expect(res.doc['1']).toEqual(local)
    expect(store.schedule).not.toHaveBeenCalled()
    const base = store.storage.get(`share-pull-base-v1:${OWNER}:${SHARE}`) as Record<
      string,
      unknown
    >
    expect(base?.['1']).toBeUndefined()
  })

  it('本地改过、共享层没动 ⇒ 不推共享层，也不打扰', async () => {
    const local = [stroke('blue')]
    const remote = [stroke('red')]
    store.docs.set(`${OWNER}:${DOC}`, { '1': local })
    store.storage.set(`share-pull-base-v1:${OWNER}:${SHARE}`, {
      '1': { fp: pageFingerprint(remote), version: 'v1' },
    })
    store.shareRows = [remoteRow(1, remote, 'v1')]

    const res = await pullShareLayer({ owner: OWNER, shareId: SHARE, docKey: DOC })

    expect(res.adopted).toEqual([])
    expect(res.conflicts).toEqual([])
    expect(res.doc['1']).toEqual(local)
    // 只更新了基线，没有把本地的笔迹推到共享层
    expect(store.schedule).not.toHaveBeenCalled()
  })

  it('写盘失败：不推进基线、adopted 为空（下一轮重试，不静默丢内容）', async () => {
    store.saveFails = true
    store.shareRows = [remoteRow(1, [stroke('red')], 'v1')]

    const res = await pullShareLayer({ owner: OWNER, shareId: SHARE, docKey: DOC })

    expect(res.adopted).toEqual([])
    expect(res.saveFailed).toBe(true)
    expect(store.storage.get(`share-pull-base-v1:${OWNER}:${SHARE}`)).toBeUndefined()
    expect(store.schedule).not.toHaveBeenCalled()
  })

  it('共享层改过、本地没动 ⇒ 收下新版本', async () => {
    const oldRemote = [stroke('red')]
    const newRemote = [stroke('red'), stroke('green')]
    store.docs.set(`${OWNER}:${DOC}`, { '1': oldRemote })
    store.storage.set(`share-pull-base-v1:${OWNER}:${SHARE}`, {
      '1': { fp: pageFingerprint(oldRemote), version: 'v1' },
    })
    store.shareRows = [remoteRow(1, newRemote, 'v2')]

    const res = await pullShareLayer({ owner: OWNER, shareId: SHARE, docKey: DOC })

    expect(res.adopted).toEqual([1])
    expect(res.doc['1']).toEqual(newRemote)
  })
})

describe('resolveSharePullConflict：三选一，只写个人层', () => {
  const local = [stroke('blue')]
  const remote = [stroke('red')]
  const conflict = { page: 1, local, remote, remoteVersion: 'v1' }

  it('local：保留我的；基线推进到共享层这一版', async () => {
    store.docs.set(`${OWNER}:${DOC}`, { '1': local })
    store.versionRow = { version: 'v1' }

    const res = await resolveSharePullConflict({
      owner: OWNER,
      shareId: SHARE,
      docKey: DOC,
      conflict,
      choice: 'local',
    })

    expect(res).toEqual({ ok: true, strokes: local })
    expect(store.schedule).not.toHaveBeenCalled()
    const base = store.storage.get(`share-pull-base-v1:${OWNER}:${SHARE}`) as Record<
      string,
      { version?: string }
    >
    expect(base['1'].version).toBe('v1')
  })

  it('remote：先归档我的，再采纳共享层', async () => {
    store.docs.set(`${OWNER}:${DOC}`, { '1': local })
    store.versionRow = { version: 'v1' }

    const res = await resolveSharePullConflict({
      owner: OWNER,
      shareId: SHARE,
      docKey: DOC,
      conflict,
      choice: 'remote',
    })

    expect(res).toEqual({ ok: true, strokes: remote })
    expect(supa.rpc).toHaveBeenCalledWith('archive_share_user_annotation', {
      p_share_id: SHARE,
      p_page: 1,
      p_strokes: local,
    })
    expect(store.docs.get(`${OWNER}:${DOC}`)?.['1']).toEqual(remote)
    expect(store.schedule).toHaveBeenCalledWith(DOC)
  })

  it('merge：取并集', async () => {
    store.docs.set(`${OWNER}:${DOC}`, { '1': local })
    store.versionRow = { version: 'v1' }

    const res = await resolveSharePullConflict({
      owner: OWNER,
      shareId: SHARE,
      docKey: DOC,
      conflict,
      choice: 'merge',
    })

    expect(res.ok).toBe(true)
    expect(res.strokes).toEqual([...local, ...remote])
    expect(store.docs.get(`${OWNER}:${DOC}`)?.['1']).toEqual([...local, ...remote])
  })

  it('写盘失败：返回 ok=false，不推进基线', async () => {
    store.docs.set(`${OWNER}:${DOC}`, { '1': local })
    store.saveFails = true
    store.versionRow = { version: 'v1' }

    const res = await resolveSharePullConflict({
      owner: OWNER,
      shareId: SHARE,
      docKey: DOC,
      conflict,
      choice: 'merge',
    })

    expect(res).toEqual({ ok: false, strokes: null })
    expect(store.storage.get(`share-pull-base-v1:${OWNER}:${SHARE}`)).toBeUndefined()
  })

  it('提交前共享层又变了 ⇒ raced，什么都不写', async () => {
    store.docs.set(`${OWNER}:${DOC}`, { '1': local })
    store.versionRow = { version: 'v2' }

    const res = await resolveSharePullConflict({
      owner: OWNER,
      shareId: SHARE,
      docKey: DOC,
      conflict,
      choice: 'remote',
    })

    expect(res).toEqual({ ok: false, raced: true, strokes: null })
    expect(supa.rpc).not.toHaveBeenCalled()
    expect(store.docs.get(`${OWNER}:${DOC}`)?.['1']).toEqual(local)
  })
})
