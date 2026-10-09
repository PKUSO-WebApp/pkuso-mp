import Taro from '@tarojs/taro'

/**
 * 页图本地文件的**跨会话记账**。
 *
 * 为什么需要：页图预下载落的是 `downloadFile` 的**临时文件**，微信的策略是「退出时占用
 * 不超 2GB 就不清理」——文件往往还在，而记账（`fileId#页号` → 路径）**只在内存里**
 * （见 page-image.ts 的 fileCache），进程一换就空 ⇒ 整册重下。把记账按册写进 Storage，
 * 进册时逐条探活（`fs.access`，官方推荐的临时文件复用判据），文件还在就直接用、
 * 不在就删掉重下。
 *
 * ⚠️ 它的正确定位是 **best-effort 缓存**，不是仓库：官方对临时文件的定性是「只保证当前
 * 生命周期内有效，冷启动不保证可用」。任何一条记账都可能在下次进册时被探活刷掉，
 * 调用方必须随时能退回「重新下载」（page-image 的第 0 档本来就是这么写的）。
 *
 * 按**册**分键（而不是一个全局大 blob）的理由：写一次只有几 KB（进册/翻页时写不卡），
 * 淘汰以册为单位（和用户的认知一致），且单条键不会撞 Storage 的单键上限。
 */

/** Storage 键前缀。改它 = 让所有旧记账失效（只在记账形态变了时才该改） */
export const ALBUM_KEY_PREFIX = 'pkuso-pagefile:'
/**
 * 最多保留几册的记账（超出按最近使用淘汰）。
 *
 * 20 册 × 最多 40 页 × 约 110 字节 ≈ 90KB，离 Storage 的 10MB 总配额很远；真正的容量
 * 上限在平台的临时文件清理（2GB），这里只是别让记账无界增长。
 */
export const MAX_ALBUMS = 20
/** 单册记账的页数上限（防呆：页数异常大的一册别把一条键写成大文件） */
export const MAX_PAGES = 400

/** 一册的记账：`t` = 最近一次使用时间（LRU 用），`p[i]` = 第 i+1 页的本地路径（`''` = 没有） */
export type AlbumRecord = { t: number; p: string[] }

export function albumStorageKey(fileId: string): string {
  return `${ALBUM_KEY_PREFIX}${fileId}`
}

/**
 * 解析一册的记账。**容忍坏数据**：Storage 里可能是别的版本写的、或被人手改过，
 * 解析不出来一律当「没有」——重建的代价只是重下一次，而抛出去会打断进册。
 */
export function parseAlbum(raw: unknown): AlbumRecord | null {
  if (typeof raw !== 'string' || raw === '') return null
  try {
    const o = JSON.parse(raw) as unknown
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null
    const rec = o as { t?: unknown; p?: unknown }
    if (!Array.isArray(rec.p)) return null
    return {
      t: typeof rec.t === 'number' && Number.isFinite(rec.t) ? rec.t : 0,
      p: rec.p.slice(0, MAX_PAGES).map((v) => (typeof v === 'string' ? v : '')),
    }
  } catch {
    return null
  }
}

/**
 * LRU 淘汰：超出 `max` 册时返回**要删掉的 Storage 键**（最久没用过的先删）。
 * 时间戳相同时按传入顺序（`sort` 是稳定的）——所以调用方的顺序也参与决定。
 */
export function pickAlbumEvictions(entries: { key: string; t: number }[], max: number): string[] {
  if (entries.length <= max) return []
  return [...entries]
    .sort((a, b) => a.t - b.t)
    .slice(0, entries.length - max)
    .map((e) => e.key)
}

/** 存储与文件系统的注入点（用例给假的；真实现见 taroPageFileStoreDeps） */
export type PageFileStoreDeps = {
  get(key: string): string
  set(key: string, value: string): void
  remove(key: string): void
  /** Storage 里现有的全部键（找同前缀的册 + 淘汰用） */
  keys(): string[]
  /** 这个本地路径还在不在（`fs.access`） */
  access(path: string): Promise<boolean>
}

function taroPageFileStoreDeps(): PageFileStoreDeps {
  return {
    get: (key) => {
      try {
        return String(Taro.getStorageSync(key) ?? '')
      } catch {
        return ''
      }
    },
    set: (key, value) => {
      try {
        Taro.setStorageSync(key, value)
      } catch {
        // 存储满 / 超限：这一册这次没记上，下次进册重下即可——**不能让它打断阅读**
      }
    },
    remove: (key) => {
      try {
        Taro.removeStorageSync(key)
      } catch {
        /* 删不掉就留着，下次探活会把它清空 */
      }
    },
    keys: () => {
      try {
        return Taro.getStorageInfoSync()?.keys ?? []
      } catch {
        return []
      }
    },
    access: (path) =>
      new Promise<boolean>((resolve) => {
        try {
          const fs = Taro.getFileSystemManager?.()
          if (!fs) {
            resolve(false)
            return
          }
          fs.access({ path, success: () => resolve(true), fail: () => resolve(false) })
        } catch {
          resolve(false)
        }
      }),
  }
}

let singleton: PageFileStoreDeps | null = null

/** 进程内单例。各方法内部才碰 Taro，所以模块加载时不会调任何小程序 API（用例可安心 import） */
export function pageFileStore(): PageFileStoreDeps {
  if (!singleton) singleton = taroPageFileStoreDeps()
  return singleton
}

/**
 * 读出这一册**还活着**的本地路径：下标 i 对应第 i+1 页，`''` = 没有 / 已失效。
 *
 * 逐条 `fs.access` 探活。探活失败的一律当没有——宁可重下一页，也不能把一条死路径交出去
 * （交出去的表现是「这一页一直转圈」，比慢更糟）。
 *
 * 没记过的册**不写也不探活**（进册时留一条空账没有意义，还白占一次写）；记过的册无论
 * 有没有变化都写回一次，作用是**更新时间戳**——打开过本身就是「最近用过」，不该被淘汰。
 * 探完一条都不剩（文件全被平台清了）则把这条账删掉。
 */
export async function loadAliveAlbum(
  fileId: string,
  pageCount: number,
  deps: PageFileStoreDeps,
  now: number
): Promise<string[]> {
  const n = Math.max(0, Math.min(Math.floor(pageCount), MAX_PAGES))
  const empty = new Array<string>(n).fill('')
  if (!fileId || n === 0) return empty
  const key = albumStorageKey(fileId)
  const rec = parseAlbum(deps.get(key))
  if (!rec) return empty
  const alive: string[] = []
  for (let i = 0; i < n; i += 1) alive.push(rec.p[i] ?? '')
  const checked = await Promise.all(alive.map(async (p) => (p && (await deps.access(p)) ? p : '')))
  if (checked.every((p) => p === '')) deps.remove(key)
  else deps.set(key, JSON.stringify({ t: now, p: checked }))
  return checked
}

/**
 * 写回这一册的记账，并淘汰超出的册。
 *
 * 调用时机由调用方定（换册、泵排空、离开页面、翻页防抖）——**不是**每下完一页写一次：
 * 一次写要序列化整册，落在翻页的关键路径上不值当。
 */
export function saveAlbum(
  fileId: string,
  paths: readonly string[],
  deps: PageFileStoreDeps,
  now: number
): void {
  if (!fileId) return
  const p = paths.slice(0, MAX_PAGES).map((v) => (typeof v === 'string' ? v : ''))
  // 一条都没有：删掉这条账，别留空账（下次探活、LRU 都白跑一趟）
  if (p.every((v) => v === '')) {
    deps.remove(albumStorageKey(fileId))
    return
  }
  deps.set(albumStorageKey(fileId), JSON.stringify({ t: now, p }))
  const mine = deps.keys().filter((k) => k.startsWith(ALBUM_KEY_PREFIX))
  if (mine.length <= MAX_ALBUMS) return
  const entries = mine.map((key) => ({ key, t: parseAlbum(deps.get(key))?.t ?? 0 }))
  for (const key of pickAlbumEvictions(entries, MAX_ALBUMS)) deps.remove(key)
}
