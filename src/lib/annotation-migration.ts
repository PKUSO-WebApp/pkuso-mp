import Taro from '@tarojs/taro'
import { GUEST_ANNO_OWNER, annoStoragePrefix } from './annotation'
import {
  ANNO_PENDING_KEY,
  LEGACY_ANNO_PENDING_KEY,
  annoConflictKey,
  annoConflictPrefix,
  annoSyncKey,
  annoSyncPrefix,
} from './annotation-sync'

/** 共享谱本地草稿键前缀（与 pages/score-reader/lib/shared-draft-store 保持同名） */
const SHARED_DRAFT_PREFIX = 'score-shared-draft-v1:'

/** 上一次在本机写批注的账号（跨账号切换时据此清理上一个账号的本地目录） */
export const ANNO_LAST_OWNER_KEY = 'score-annotation-last-owner'

const LEGACY_SYNC_PREFIX = 'score-annotation-sync:'
const LEGACY_CONFLICT_PREFIX = 'score-annotation-conflict:'
const LEGACY_DOC_PREFIX = 'score-annotation:'

const storageKeys = (): string[] => {
  try {
    const info = Taro.getStorageInfoSync?.()
    return Array.isArray(info?.keys) ? info.keys : []
  } catch {
    return []
  }
}

const remove = (key: string): void => {
  try {
    Taro.removeStorageSync(key)
  } catch {
    /* 删不掉就下次再删 */
  }
}

/**
 * 把旧键复制到新键，**复制成功后才删旧键**（D16）。
 * 新键已存在时不覆盖 —— 新键才是当前版本写过的内容。
 */
const copyThenRemove = (from: string, to: string): void => {
  try {
    const raw = Taro.getStorageSync(from)
    if (!raw) {
      remove(from)
      return
    }
    if (Taro.getStorageSync(to)) {
      remove(from)
      return
    }
    Taro.setStorageSync(to, raw)
    remove(from)
  } catch {
    // 写失败就保留旧键：下次启动再试，不能把用户内容弄丢
  }
}

/**
 * 同步基线 / 冲突记录的值里也有 `userId`，迁移时必须一起改成新 owner。
 * 只改存储键不改值的话，`loadSyncBase` 的 `record.userId !== userId` 会把它当没有。
 */
const copyRecordThenRemove = (from: string, to: string, owner: string): void => {
  try {
    const raw = Taro.getStorageSync(from)
    if (!raw) {
      remove(from)
      return
    }
    if (Taro.getStorageSync(to)) {
      remove(from)
      return
    }
    let next: unknown = raw
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          next = JSON.stringify({ ...parsed, userId: owner })
        }
      } catch {
        // 坏数据原样搬过去：load 侧本来就会当空
      }
    }
    Taro.setStorageSync(to, next)
    remove(from)
  } catch {
    // 写失败就保留旧键：下次启动再试
  }
}

const parseRecordUserId = (raw: unknown): string | null => {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const parsed = JSON.parse(raw) as { userId?: unknown }
    return typeof parsed?.userId === 'string' && parsed.userId ? parsed.userId : null
  } catch {
    return null
  }
}

/**
 * D16 迁移：旧的无 owner 键 → 当前账号目录；guest 目录 → 当前账号。
 *
 * 旧批注正文没有 owner，沿用「设备当前用户拥有旧内容」的现状假设；旧同步/冲突记录里
 * **带 userId**，按它归属（不属于当前账号也照样迁到那个用户名下，登录后自然可见）。
 * 幂等：可以每次会话恢复都跑；新键存在时只删旧键。
 */
export function migrateAnnotationStorage(userId: string): void {
  if (!userId) return
  const keys = storageKeys()

  for (const key of keys) {
    if (typeof key !== 'string') continue

    // 旧批注正文：score-annotation:<fileId>
    if (key.startsWith(LEGACY_DOC_PREFIX)) {
      const fileId = key.slice(LEGACY_DOC_PREFIX.length)
      if (fileId) copyThenRemove(key, `${annoStoragePrefix(userId)}${fileId}`)
      continue
    }

    // 旧同步基线：score-annotation-sync:<fileId>
    if (key.startsWith(LEGACY_SYNC_PREFIX)) {
      const fileId = key.slice(LEGACY_SYNC_PREFIX.length)
      const raw = Taro.getStorageSync(key)
      const owner = parseRecordUserId(raw) ?? userId
      if (fileId) copyRecordThenRemove(key, annoSyncKey(owner, fileId), owner)
      continue
    }

    // 旧冲突记录：score-annotation-conflict:<fileId>
    if (key.startsWith(LEGACY_CONFLICT_PREFIX)) {
      const fileId = key.slice(LEGACY_CONFLICT_PREFIX.length)
      const raw = Taro.getStorageSync(key)
      const owner = parseRecordUserId(raw) ?? userId
      if (fileId) copyRecordThenRemove(key, annoConflictKey(owner, fileId), owner)
    }
  }

  // 全局欠账标记 → 当前账号
  try {
    if (Taro.getStorageSync(LEGACY_ANNO_PENDING_KEY) === true) {
      if (Taro.getStorageSync(ANNO_PENDING_KEY(userId)) !== true) {
        Taro.setStorageSync(ANNO_PENDING_KEY(userId), true)
      }
      remove(LEGACY_ANNO_PENDING_KEY)
    }
  } catch {
    /* 迁不动就留着，下次再试 */
  }

  if (userId === GUEST_ANNO_OWNER) return

  // guest 目录 → 当前账号（未登录时画的、或上一轮登出后留下的）
  for (const key of storageKeys()) {
    if (typeof key !== 'string' || !key.startsWith(annoStoragePrefix(GUEST_ANNO_OWNER))) continue
    const fileId = key.slice(annoStoragePrefix(GUEST_ANNO_OWNER).length)
    if (fileId) copyThenRemove(key, `${annoStoragePrefix(userId)}${fileId}`)
  }
  for (const key of storageKeys()) {
    if (typeof key !== 'string' || !key.startsWith(annoSyncPrefix(GUEST_ANNO_OWNER))) continue
    const fileId = key.slice(annoSyncPrefix(GUEST_ANNO_OWNER).length)
    if (fileId) copyRecordThenRemove(key, annoSyncKey(userId, fileId), userId)
  }
  for (const key of storageKeys()) {
    if (typeof key !== 'string' || !key.startsWith(annoConflictPrefix(GUEST_ANNO_OWNER))) continue
    const fileId = key.slice(annoConflictPrefix(GUEST_ANNO_OWNER).length)
    if (fileId) copyRecordThenRemove(key, annoConflictKey(userId, fileId), userId)
  }
  try {
    if (Taro.getStorageSync(ANNO_PENDING_KEY(GUEST_ANNO_OWNER)) === true) {
      if (Taro.getStorageSync(ANNO_PENDING_KEY(userId)) !== true) {
        Taro.setStorageSync(ANNO_PENDING_KEY(userId), true)
      }
      remove(ANNO_PENDING_KEY(GUEST_ANNO_OWNER))
    }
  } catch {
    /* 同上 */
  }
}

/** 删掉某个账号在本机的全部批注数据（登出清理 / 换账号清理） */
export function clearAnnotationStorageFor(owner: string): void {
  if (!owner) return
  const prefixes = [
    annoStoragePrefix(owner),
    annoSyncPrefix(owner),
    annoConflictPrefix(owner),
    `${SHARED_DRAFT_PREFIX}${owner}:`,
  ]
  for (const key of storageKeys()) {
    if (typeof key !== 'string') continue
    if (prefixes.some((p) => key.startsWith(p)) || key === ANNO_PENDING_KEY(owner)) {
      remove(key)
    }
  }
}

export function readLastAnnoOwner(): string | null {
  try {
    const v = Taro.getStorageSync(ANNO_LAST_OWNER_KEY)
    return typeof v === 'string' && v ? v : null
  } catch {
    return null
  }
}

export function writeLastAnnoOwner(owner: string): void {
  try {
    Taro.setStorageSync(ANNO_LAST_OWNER_KEY, owner)
  } catch {
    /* 记不下只影响换账号时的清理，不影响正确性 */
  }
}
