import { beforeEach, describe, expect, it, vi } from 'vitest'
import { annoStorageKey, GUEST_ANNO_OWNER } from './annotation'
import {
  ANNO_PENDING_KEY,
  annoConflictKey,
  annoSyncKey,
  isAnnoPending,
  loadConflicts,
  loadSyncBase,
  markAnnoPending,
  saveConflicts,
  saveSyncBase,
} from './annotation-sync'
import {
  ANNO_LAST_OWNER_KEY,
  clearAnnotationStorageFor,
  migrateAnnotationStorage,
  readLastAnnoOwner,
  writeLastAnnoOwner,
} from './annotation-migration'

const storage = new Map<string, unknown>()

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
  },
}))

const doc = JSON.stringify({ '1': [{ color: '#111', width: 0.004, points: [[0, 0]] }] })

beforeEach(() => {
  storage.clear()
})

describe('migrateAnnotationStorage（D16）', () => {
  it('旧批注正文归当前用户；旧键删除', () => {
    storage.set('score-annotation:f1', doc)
    migrateAnnotationStorage('u1')

    expect(storage.has('score-annotation:f1')).toBe(false)
    expect(storage.get(annoStorageKey('u1', 'f1'))).toBe(doc)
  })

  it('旧同步/冲突记录按记录里的 userId 归属，而不是当前用户', () => {
    storage.set(
      'score-annotation-sync:f1',
      JSON.stringify({ userId: 'u9', base: { '1': { fp: 'aaaa' } } })
    )
    storage.set('score-annotation-conflict:f1', JSON.stringify({ userId: 'u9', pages: [3] }))
    migrateAnnotationStorage('u1')

    expect(storage.has('score-annotation-sync:f1')).toBe(false)
    expect(storage.has('score-annotation-conflict:f1')).toBe(false)
    expect(loadSyncBase('f1', 'u9')).toEqual({ '1': { fp: 'aaaa' } })
    expect(loadConflicts('f1', 'u9')).toEqual([3])
    expect(loadSyncBase('f1', 'u1')).toEqual({})
  })

  it('旧欠账标记归当前用户', () => {
    storage.set('score-annotation-pending', true)
    migrateAnnotationStorage('u1')

    expect(storage.has('score-annotation-pending')).toBe(false)
    expect(isAnnoPending('u1')).toBe(true)
    expect(isAnnoPending('u2')).toBe(false)
  })

  it('新键已存在时不覆盖，只删旧键', () => {
    storage.set('score-annotation:f1', JSON.stringify({ '1': [] }))
    storage.set(annoStorageKey('u1', 'f1'), doc)
    migrateAnnotationStorage('u1')

    expect(storage.has('score-annotation:f1')).toBe(false)
    expect(storage.get(annoStorageKey('u1', 'f1'))).toBe(doc)
  })

  it('guest 目录迁到当前账号，并删掉 guest 键', () => {
    storage.set(annoStorageKey(GUEST_ANNO_OWNER, 'f1'), doc)
    storage.set(annoSyncKey(GUEST_ANNO_OWNER, 'f1'), JSON.stringify({ userId: 'guest', base: {} }))
    storage.set(
      annoConflictKey(GUEST_ANNO_OWNER, 'f1'),
      JSON.stringify({ userId: 'guest', pages: [2] })
    )
    markAnnoPending(GUEST_ANNO_OWNER)

    migrateAnnotationStorage('u1')

    expect(storage.has(annoStorageKey(GUEST_ANNO_OWNER, 'f1'))).toBe(false)
    expect(storage.has(annoSyncKey(GUEST_ANNO_OWNER, 'f1'))).toBe(false)
    expect(storage.has(annoConflictKey(GUEST_ANNO_OWNER, 'f1'))).toBe(false)
    expect(storage.get(annoStorageKey('u1', 'f1'))).toBe(doc)
    expect(isAnnoPending('u1')).toBe(true)
    expect(isAnnoPending(GUEST_ANNO_OWNER)).toBe(false)
  })

  it('幂等：跑两次结果一样', () => {
    storage.set('score-annotation:f1', doc)
    migrateAnnotationStorage('u1')
    const once = new Map(storage)
    migrateAnnotationStorage('u1')

    expect(new Map(storage)).toEqual(once)
  })

  it('坏掉的旧同步记录不阻断其它键的迁移', () => {
    storage.set('score-annotation-sync:bad', 'not json')
    storage.set('score-annotation:f1', doc)

    migrateAnnotationStorage('u1')

    expect(storage.has('score-annotation-sync:bad')).toBe(false)
    expect(storage.get(annoStorageKey('u1', 'f1'))).toBe(doc)
  })
})

describe('clearAnnotationStorageFor / last owner', () => {
  it('只删指定账号的批注键，不碰别人的与非批注键', () => {
    storage.set(annoStorageKey('u1', 'f1'), doc)
    storage.set(annoStorageKey('u2', 'f1'), doc)
    storage.set(annoSyncKey('u1', 'f1'), '{}')
    storage.set(annoConflictKey('u1', 'f1'), '{}')
    storage.set(ANNO_PENDING_KEY('u1'), true)
    storage.set('pkuso_error_queue', '[]')

    clearAnnotationStorageFor('u1')

    expect(storage.has(annoStorageKey('u1', 'f1'))).toBe(false)
    expect(storage.has(annoSyncKey('u1', 'f1'))).toBe(false)
    expect(storage.has(annoConflictKey('u1', 'f1'))).toBe(false)
    expect(storage.has(ANNO_PENDING_KEY('u1'))).toBe(false)
    expect(storage.has(annoStorageKey('u2', 'f1'))).toBe(true)
    expect(storage.has('pkuso_error_queue')).toBe(true)
  })

  it('last owner 往返', () => {
    expect(readLastAnnoOwner()).toBeNull()
    writeLastAnnoOwner('u1')
    expect(readLastAnnoOwner()).toBe('u1')
    // 与 clearAnnotationStorageFor 无关：换账号判定要用它
    clearAnnotationStorageFor('u1')
    expect(readLastAnnoOwner()).toBe('u1')
    expect(storage.has(ANNO_LAST_OWNER_KEY)).toBe(true)
  })
})

// 这组测试直接 pin 住 key 形状：迁移与清理都按前缀扫，形状一变必须同步改
describe('key 形状（防漂移）', () => {
  it('正文 / 同步 / 冲突 / 欠账都带 owner', () => {
    expect(annoStorageKey('u1', 'f1')).toBe('score-annotation-v2:u1:f1')
    expect(annoSyncKey('u1', 'f1')).toBe('score-annotation-sync-v2:u1:f1')
    expect(annoConflictKey('u1', 'f1')).toBe('score-annotation-conflict-v2:u1:f1')
    expect(ANNO_PENDING_KEY('u1')).toBe('score-annotation-pending-v2:u1')
  })

  it('saveSyncBase / saveConflicts 写的是带 owner 的键', () => {
    saveSyncBase('f1', 'u1', { '1': { fp: 'aaaa' } })
    saveConflicts('f1', 'u1', [2])
    expect(storage.has('score-annotation-sync-v2:u1:f1')).toBe(true)
    expect(storage.has('score-annotation-conflict-v2:u1:f1')).toBe(true)
  })
})
