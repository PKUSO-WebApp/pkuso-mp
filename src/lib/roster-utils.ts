import { INSTRUMENT_ORDER, OTHER_INSTRUMENT_GROUP } from '@/constants/instruments'
import type { ProfileRow } from '@/types/database'
import { pinyinSortKey } from './pinyin-sort'

/**
 * 花名册分组/排序工具（纯函数，可单测）
 * 用户侧与 admin 侧共用，保证两端排序行为一致。
 */

/** 乐器分组 key：命中 INSTRUMENT_ORDER 用原值，否则归入「其他」 */
export function instrumentGroupKey(instrument: string | null): string {
  if (!instrument) return OTHER_INSTRUMENT_GROUP
  const trimmed = instrument.trim()
  if (INSTRUMENT_ORDER.includes(trimmed as (typeof INSTRUMENT_ORDER)[number])) return trimmed
  return OTHER_INSTRUMENT_GROUP
}

/** 声部分组结果 */
export type RosterGroup = {
  group: string
  users: ProfileRow[]
}

/**
 * 组内排序：声部长（is_section_leader）排最前（多个声部长之间同样按姓名拼音），
 * 其余按**姓名拼音**排序。
 *
 * 拼音键走共用的 `pinyinSortKey`（见 ./pinyin-sort），**不是** `localeCompare(x, 'zh-CN')`
 * ——后者依赖运行时的 ICU 排序数据，真机上实测不出拼音序（2026-10-11 用户报「看着像按
 * 创建时间倒序」）。同音（键相同）时再按原值定序，保证先后与查询返回顺序无关。
 */
export function sortGroupMembers(users: ProfileRow[]): ProfileRow[] {
  return [...users].sort((a, b) => {
    const aLeader = a.is_section_leader ? 0 : 1
    const bLeader = b.is_section_leader ? 0 : 1
    if (aLeader !== bLeader) return aLeader - bLeader
    const an = String(a.full_name ?? '')
    const bn = String(b.full_name ?? '')
    const ka = pinyinSortKey(an)
    const kb = pinyinSortKey(bn)
    if (ka !== kb) return ka < kb ? -1 : 1
    return an < bn ? -1 : an > bn ? 1 : 0
  })
}

/**
 * 按声部顺序分组：INSTRUMENT_ORDER 顺序在前，「其他」最后。
 * 组内成员先经 sortGroupMembers 排序（声部长优先）。
 */
export function groupProfilesByInstrument(rows: ProfileRow[]): RosterGroup[] {
  const map = new Map<string, ProfileRow[]>()
  for (const row of rows) {
    const g = instrumentGroupKey(row.instrument)
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(row)
  }
  const ordered: RosterGroup[] = []
  for (const key of INSTRUMENT_ORDER) {
    const users = map.get(key)
    if (users?.length) ordered.push({ group: key, users: sortGroupMembers(users) })
  }
  const other = map.get(OTHER_INSTRUMENT_GROUP)
  if (other?.length) ordered.push({ group: OTHER_INSTRUMENT_GROUP, users: sortGroupMembers(other) })
  return ordered
}
