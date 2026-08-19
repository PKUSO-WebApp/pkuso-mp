import { INSTRUMENT_ORDER, OTHER_INSTRUMENT_GROUP } from '@/constants/instruments'
import type { ProfileRow } from '@/types/database'

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
 * 组内排序：声部长（is_section_leader）排最前（多个声部长之间按姓名排序），
 * 其余按姓名（zh-CN localeCompare）排序。
 */
export function sortGroupMembers(users: ProfileRow[]): ProfileRow[] {
  return [...users].sort((a, b) => {
    const aLeader = a.is_section_leader ? 0 : 1
    const bLeader = b.is_section_leader ? 0 : 1
    if (aLeader !== bLeader) return aLeader - bLeader
    return String(a.full_name ?? '').localeCompare(String(b.full_name ?? ''), 'zh-CN')
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
