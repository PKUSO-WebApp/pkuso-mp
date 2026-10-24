/**
 * 默认分声部的候选号（P7c，2026-10-24 用户定）。
 *
 * 偏好是**成员级单一值**，但候选范围按声部类别不同：
 *   - 管乐（`木管` / `铜管` 组）：默认 1–4；库里文件出现更大的号也纳入（高音号确实存在）；
 *   - 弦乐（`弦乐` 组）：声部已经按乐器拆开，不区分分声部；
 *   - 其他（打击乐等）：暂不定义范围，只保留「未设置」。
 *
 * 类别从 `sections` / `section_group_members` 字典派生，不在客户端另抄一份乐器清单。
 * 偏好号本身仍不校验是否出现在某份文件里（设成 5 的成员在没有第 5 份的曲子里
 * 只是不计入份数）。
 */
export const SUB_PART_DEFAULT_MAX = 4
export const WIND_GROUP_NAMES = ['木管', '铜管'] as const
export const STRING_GROUP_NAME = '弦乐'

export type SubPartPolicy = 'range' | 'unset-only' | 'none'

/** 该乐器属于哪一类候选范围；组名来自声部字典 */
export function resolveSubPartPolicy(groups: readonly string[]): SubPartPolicy {
  const set = new Set(groups)
  if (WIND_GROUP_NAMES.some((g) => set.has(g))) return 'range'
  if (set.has(STRING_GROUP_NAME)) return 'none'
  return 'unset-only'
}

/** 管乐的默认候选号；其他类别没有默认值 */
export function defaultSubPartNumbers(policy: SubPartPolicy): number[] {
  if (policy !== 'range') return []
  return Array.from({ length: SUB_PART_DEFAULT_MAX }, (_, i) => i + 1)
}

/**
 * 候选集合 = 默认范围 ∪ 库里出现过的号 ∪ 当前已设置的值。
 *
 * 并上当前值是必须的：换声部/库里暂无对应文件时，UI 仍要能显示并清除既有值。
 * 不改入参。
 */
export function mergeSubPartOptions(
  current: number | null,
  fromFiles: Array<ReadonlyArray<number> | null | undefined>,
  defaults: ReadonlyArray<number> = []
): number[] {
  const set = new Set<number>()
  for (const n of defaults) {
    if (Number.isInteger(n) && n > 0) set.add(n)
  }
  for (const nums of fromFiles) {
    for (const n of nums ?? []) {
      if (Number.isInteger(n) && n > 0) set.add(n)
    }
  }
  if (current != null && Number.isInteger(current) && current > 0) set.add(current)
  return [...set].sort((a, b) => a - b)
}
