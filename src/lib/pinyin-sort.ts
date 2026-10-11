import { pinyin } from 'pinyin-pro'

/**
 * 拼音排序键（全仓共用一份）：`张三` → `zhangsan`、`长笛` → `changdi`、`A调单簧管` → `atiaodanhuangguan`。
 *
 * 为什么不直接用 `String.prototype.localeCompare(x, 'zh-CN')`：它依赖运行时带的 ICU
 * 排序数据，各端（iOS 的 JSC / Android 的 V8 / 开发者工具）行为不一致——谱务排序在 web 侧
 * 实测五个用例错四个（见 `sheet-music-sort.ts` 文件头），花名册在真机上实测也不是拼音序。
 * 显式算键是跨端确定的：键是纯小写拉丁串，**码点序即拼音序**。
 *
 * ⚠️ 有缓存：排序里每次比较都算拼音会成为热点（O(n log n) 次调用）。缓存的键是小集合
 * （声部名 / 姓名），无上限清理的必要。
 *
 * ⚠️ 多音字按 `pinyin-pro` 的**默认读音**取键（如「单」→ dan）。排序只要求确定、可预期，
 * 不要求把姓氏读音判对——搜索那条路要覆盖全部读音，用的是 `name-search.ts` 里另一套
 * （`multiple: true`），两者刻意不合并。
 */
const keyCache = new Map<string, string>()

export function pinyinSortKey(s: string): string {
  let key = keyCache.get(s)
  if (key === undefined) {
    key = pinyin(s, { toneType: 'none', type: 'array' }).join('').toLowerCase()
    keyCache.set(s, key)
  }
  return key
}
