import { pinyin } from 'pinyin-pro'

/**
 * 花名册拼音搜索工具（纯函数，可单测）
 *
 * 搜索规则：
 * - 输入为中文 → 按姓名包含匹配（name.includes）
 * - 输入为字母 → 用 pinyin-pro 计算姓名的全拼连写与首字母连写，包含匹配；
 *   单字母 query 匹配姓氏首字母（如 "w" 匹配所有王姓成员）
 * - 多音字姓氏（曾/单/仇/解/区/查等）通过 pinyin-pro 的 multiple 选项覆盖全部读音，
 *   拼音匹配命中任一读音组合即可
 * - 忽略大小写、忽略空格
 */

/** 判断字符串是否包含中文字符 */
export function containsChinese(text: string): boolean {
  return /[一-鿿]/.test(text)
}

/**
 * 获取单字的全部读音（多音字返回多个，如 曾 → ["ceng", "zeng"]）。
 * multiple 模式输出空格分隔的多读音字符串，拆分成数组并去重。
 * 非中文字符（英文/数字）原样返回并转小写。
 */
function getCharReadings(char: string): string[] {
  if (!char) return []
  const raw = pinyin(char, { toneType: 'none', multiple: true })
  return [
    ...new Set(
      raw
        .split(' ')
        .map((s) => s.toLowerCase())
        .filter(Boolean)
    ),
  ]
}

/** 拼音组合数上限：超过后截断读音集合，防止多音字笛卡尔积撑爆 UI 线程 */
const MAX_PINYIN_COMBINATIONS = 256

/** 对每字的读音集合做笛卡尔积，生成所有读音组合 */
function cartesianProduct<T>(sets: T[][]): T[][] {
  return sets.reduce<T[][]>(
    (acc, set) => acc.flatMap((combo) => set.map((item) => [...combo, item])),
    [[]]
  )
}

/** 受控笛卡尔积：组合数超上限时逐字截断读音（每字最多 2 个，词频靠前优先），
 *  仍超限则退化为默认读音单组合；保证超长多音字姓名不会产生指数级组合 */
function cappedCartesianProduct<T>(sets: T[][]): T[][] {
  const total = sets.reduce((acc, set) => acc * Math.max(set.length, 1), 1)
  if (total <= MAX_PINYIN_COMBINATIONS) return cartesianProduct(sets)

  const truncated = sets.map((set) => (set.length > 2 ? set.slice(0, 2) : set))
  const truncatedTotal = truncated.reduce((acc, set) => acc * Math.max(set.length, 1), 1)
  if (truncatedTotal <= MAX_PINYIN_COMBINATIONS) return cartesianProduct(truncated)

  // 仍超限：每字只取默认读音，退化为单组合
  return [truncated.map((set) => set[0]!)]
}

export type PinyinKeys = {
  /** 默认读音全拼连写（如 王梓萱 → "wangzixuan"） */
  fullPinyin: string
  /** 默认读音首字母连写（如 王梓萱 → "wzx"） */
  initials: string
  /** 多音字全拼组合（笛卡尔积，如 曾子墨 → ["cengzimo", "zengzimo"]） */
  fullPinyinList: string[]
  /** 多音字首字母组合（如 曾子墨 → ["czm", "zzm"]） */
  initialsList: string[]
  /** 姓氏（首字）全部读音（如 曾 → ["ceng", "zeng"]） */
  surnamePinyin: string[]
  /** 姓氏（首字）全部首字母，去重（如 曾 → ["c", "z"]） */
  surnameInitials: string[]
}

/** 计算姓名的全拼与首字母连写，忽略空格，统一小写；多音字返回全部读音组合 */
export function computePinyinKeys(name: string): PinyinKeys {
  const trimmed = name.replace(/\s+/g, '')
  const chars = [...trimmed]

  // 默认读音（词频优先，与 single 行为一致）
  const fullPinyin = pinyin(trimmed, { toneType: 'none', type: 'array' })
    .map((s) => s.toLowerCase())
    .join('')
  const initials = pinyin(trimmed, { pattern: 'first', toneType: 'none', type: 'array' })
    .map((s) => s.charAt(0).toLowerCase())
    .join('')

  // 多音字：逐字取全部读音，做笛卡尔积（超限自动截断，见 cappedCartesianProduct）
  const charReadingSets = chars.map(getCharReadings)
  const fullPinyinList = cappedCartesianProduct(charReadingSets).map((combo) => combo.join(''))
  const initialsList = cappedCartesianProduct(
    charReadingSets.map((readings) => readings.map((r) => r.charAt(0)))
  ).map((combo) => combo.join(''))

  // 姓氏（首字）读音集合：用于单字母 query 匹配
  const surnameReadings = charReadingSets[0] ?? []
  const surnamePinyin = surnameReadings
  const surnameInitials = [...new Set(surnameReadings.map((r) => r.charAt(0)))]

  return { fullPinyin, initials, fullPinyinList, initialsList, surnamePinyin, surnameInitials }
}

/** 可被搜索的成员行：只需 id 与 full_name */
export type NameSearchable = {
  id: string
  full_name: string | null
}

/**
 * 按查询词过滤成员列表。
 * query 为空或全空白时返回原列表；不匹配任何规则时返回空数组。
 */
export function filterByName<T extends NameSearchable>(rows: T[], query: string): T[] {
  const q = query.replace(/\s+/g, '').toLowerCase()
  if (!q) return rows

  // 中文输入 → 按姓名包含匹配
  if (containsChinese(q)) {
    return rows.filter((r) => (r.full_name ?? '').includes(q))
  }

  // 字母输入 → 全拼 / 首字母 / 姓氏首字母匹配（均覆盖多音字读音组合）
  return rows.filter((r) => {
    const name = r.full_name ?? ''
    if (!name) return false
    const keys = computePinyinKeys(name)
    if (q.length === 1) {
      // 单字母匹配姓氏首字母（如 "w" 匹配王姓、"z" 匹配曾/张姓）
      return keys.surnameInitials.includes(q)
    }
    return (
      keys.fullPinyinList.some((p) => p.includes(q)) || keys.initialsList.some((p) => p.includes(q))
    )
  })
}
