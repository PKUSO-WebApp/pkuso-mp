import Taro from '@tarojs/taro'
import type { AnnoStroke } from '@/lib/annotation'

/**
 * 共享谱的**本地草稿**（D16 账号隔离）。
 *
 * 共享批注没有「本地正文」：正文只在共享表里。冲突或防抖未落盘时，用户看到的本地版本
 * 如果只放在内存，退出阅读器就没了 —— 下次进来只剩远端，看起来像「静默变成远端版」。
 *
 * 这里按 (owner, fileId, page) 存：
 * - `baseVersion`：用户动手时基于的共享版本（普通草稿用它做 CAS 期望值；远端变了就会冲突）；
 * - `conflicted`：已经发生过 CAS 冲突、还没选完；再次进入要**直接弹冲突**，不能自动推。
 *
 * 与个人批注的区别：个人正文本身就是本地真相（loadAnnoDoc），这里只是**未落盘的补丁**。
 */
export type SharedDraftPage = {
  local: AnnoStroke[]
  baseVersion: string
  conflicted: boolean
}

type DraftRecord = {
  userId: string
  pages: Record<string, SharedDraftPage>
}

export const sharedDraftPrefix = (owner: string) => `score-shared-draft-v1:${owner}:`
const keyOf = (owner: string, fileId: string) => `${sharedDraftPrefix(owner)}${fileId}`

const normalizePage = (raw: unknown): SharedDraftPage | null => {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as { local?: unknown; baseVersion?: unknown; conflicted?: unknown }
  if (!Array.isArray(p.local)) return null
  return {
    local: p.local as AnnoStroke[],
    baseVersion: typeof p.baseVersion === 'string' ? p.baseVersion : '',
    conflicted: p.conflicted === true,
  }
}

export function loadSharedDrafts(owner: string, fileId: string): Map<number, SharedDraftPage> {
  const out = new Map<number, SharedDraftPage>()
  try {
    const raw = Taro.getStorageSync(keyOf(owner, fileId))
    if (!raw) return out
    const parsed = JSON.parse(raw) as Partial<DraftRecord>
    if (!parsed || parsed.userId !== owner || !parsed.pages) return out
    for (const [key, value] of Object.entries(parsed.pages)) {
      const page = Number(key)
      if (!Number.isInteger(page) || page < 1) continue
      const normalized = normalizePage(value)
      if (normalized) out.set(page, normalized)
    }
  } catch {
    // 坏数据当没有；草稿丢了最多是本地那一版没保住，不影响远端
  }
  return out
}

/**
 * 写一页草稿。**空页也要存**：「我把这一页擦空、远端还有内容」是一个真实的本地版本，
 * 不能因为 `local=[]` 就当成没有草稿（那会再次静默变回远端）。
 * 不抛：草稿写不进去与「正文保存失败」不是一回事，阅读器照常可用。
 */
export function saveSharedDraft(
  owner: string,
  fileId: string,
  page: number,
  draft: SharedDraftPage
): void {
  try {
    const existing = loadSharedDrafts(owner, fileId)
    existing.set(page, draft)
    const record: DraftRecord = {
      userId: owner,
      pages: Object.fromEntries([...existing.entries()].map(([p, d]) => [String(p), d])),
    }
    Taro.setStorageSync(keyOf(owner, fileId), JSON.stringify(record))
  } catch {
    /* 存储满/不可用：保留服务端行为，草稿只是尽力而为 */
  }
}

export function clearSharedDraft(owner: string, fileId: string, page: number): void {
  try {
    const existing = loadSharedDrafts(owner, fileId)
    if (!existing.delete(page)) return
    if (existing.size === 0) {
      Taro.removeStorageSync(keyOf(owner, fileId))
      return
    }
    const record: DraftRecord = {
      userId: owner,
      pages: Object.fromEntries([...existing.entries()].map(([p, d]) => [String(p), d])),
    }
    Taro.setStorageSync(keyOf(owner, fileId), JSON.stringify(record))
  } catch {
    /* 清不掉就下次再清，无害 */
  }
}
