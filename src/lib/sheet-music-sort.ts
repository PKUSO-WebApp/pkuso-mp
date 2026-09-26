import { pinyin } from 'pinyin-pro'
import { FULL_SCORE_SECTION, INSTRUMENT_ORDER } from '@/constants/instruments'

/**
 * 曲目声部与文件的展示排序——与 pkuso-web 的 `src/app/admin/sheet-music/sort-parts.ts`
 * **同一契约**（pkuso-web#289），改逻辑前先看那边的完整论证（含实测表与用例）。
 *
 * 契约（三级）：
 *
 * 1. **声部**：按 `INSTRUMENT_ORDER`；**总谱最前**；**「其他」/未知最后**
 * 2. **同声部内**：按乐器名拼音
 * 3. **同乐器内**：按第一个分声部号；**没有号的排最前**
 *
 * ## 为什么不在数据库里排
 *
 * 两个现成的列都不表达业务顺序：`sheet_music_parts.sort_order` 实际全是 0
 * （历史遗留，上传时写死）；`sheet_music_files.created_at` 是并发 worker 的完成顺序。
 * 所以顺序在这里按业务含义算；「恰好相等」时保持传入顺序（JS sort 稳定），
 * 传入顺序来自查询的 `created_at`，是确定的、不会每次刷新都跳。
 *
 * ## 拼音
 *
 * 用 `pinyin-pro`（与 web 同款）——它已是本仓依赖（`src/lib/name-search.ts` 花名册
 * 搜索），打在主包里，排序复用**零增量体积**。不要换回 `Intl.Collator("zh-CN")`：
 * ICU 会把「长笛」读成 zhǎng 且把拉丁字母开头的名字排到所有中文名之后，
 * web 侧实测五个用例错四个（见 web 侧 sort-parts.ts 注释）。
 *
 * ⚠️ 排序键有缓存：每次比较都算拼音会成为排序热点（O(n log n) 次调用）。
 */

interface SortableFile {
  instrument: string | null
  // mp 端 database.types.ts 当前为可空（backend 迁移 `20260926130000` 把 DB 收成
  // NOT NULL 后类型由 CI 同步收紧）；此处按可空防御，语义与「没有号」一致
  sub_parts: number[] | null
}

interface SortablePart {
  section: string | null
  files: SortableFile[]
}

/**
 * 声部 → 排序档位：**总谱最前**、其余按 `INSTRUMENT_ORDER` 下标、
 * **「其他」与一切未知值（空串/ null、闭集外）最后**——未知值排最后比混进正常声部更容易被发现。
 */
export function sectionSortKey(section: string | null): number {
  const s = (section ?? '').trim()
  if (s === FULL_SCORE_SECTION) return -1
  const i = INSTRUMENT_ORDER.indexOf(s as (typeof INSTRUMENT_ORDER)[number])
  return i === -1 ? INSTRUMENT_ORDER.length : i
}

const keyCache = new Map<string, string>()

/** 拼音排序键：`长笛` → `changdi`，`A调单簧管` → `atiaodanhuangguan`。 */
function pinyinKey(s: string): string {
  let key = keyCache.get(s)
  if (key === undefined) {
    key = pinyin(s, { toneType: 'none', type: 'array' }).join('').toLowerCase()
    keyCache.set(s, key)
  }
  return key
}

/**
 * 文件 → 排序用的「第一个分声部号」。没有号（空数组）返回 0，排在所有有号的前面
 * ——合法的分声部号恒 ≥ 1，所以 0 是安全的哨兵。
 */
function firstSubPart(f: SortableFile): number {
  const first = f.sub_parts?.[0]
  return typeof first === 'number' ? first : 0
}

/** 文件比较：先按乐器名拼音，再按第一个分声部号，最后保持原顺序（稳定排序）。 */
export function compareFiles(a: SortableFile, b: SortableFile): number {
  const ka = pinyinKey(a.instrument ?? '')
  const kb = pinyinKey(b.instrument ?? '')
  // 键已是纯小写拉丁串，码点序就是拼音序；不用 localeCompare（会把 Latin 开头排到最后）
  if (ka !== kb) return ka < kb ? -1 : 1
  return firstSubPart(a) - firstSubPart(b)
}

/**
 * 排好一个曲子的全部声部与文件。**不修改入参**（返回新数组，文件也是新数组）
 * ——调用方是 React 的 state，原地排序会让「值没变」的引用比较失效。
 */
export function sortPartsForDisplay<T extends SortablePart>(parts: T[]): T[] {
  return [...parts]
    .sort((a, b) => sectionSortKey(a.section) - sectionSortKey(b.section))
    .map((part) => ({ ...part, files: [...part.files].sort(compareFiles) }))
}
