import { describe, it, expect } from 'vitest'
import { OTHER_INSTRUMENT_GROUP } from '@/constants/instruments'
import type { ProfileRow } from '@/types/database'
import { instrumentGroupKey, sortGroupMembers, groupProfilesByInstrument } from './roster-utils'

function makeUser(partial: Partial<ProfileRow> & { id: string; full_name: string }): ProfileRow {
  return {
    college: null,
    created_at: null,
    email: null,
    instrument: null,
    is_section_leader: false,
    join_date: null,
    phone_number: null,
    role: 'member',
    status: 'approved',
    ...partial,
  } as ProfileRow
}

describe('roster-utils', () => {
  describe('instrumentGroupKey', () => {
    it('命中声部顺序列表用原值', () => {
      expect(instrumentGroupKey('第一小提琴')).toBe('第一小提琴')
      expect(instrumentGroupKey(' 大提琴 ')).toBe('大提琴')
    })

    it('未知乐器归入「其他」', () => {
      expect(instrumentGroupKey('唢呐')).toBe(OTHER_INSTRUMENT_GROUP)
    })

    it('null / 空字符串归入「其他」', () => {
      expect(instrumentGroupKey(null)).toBe(OTHER_INSTRUMENT_GROUP)
      expect(instrumentGroupKey('')).toBe(OTHER_INSTRUMENT_GROUP)
    })
  })

  describe('sortGroupMembers', () => {
    it('声部长排在最前，其余按姓名排序', () => {
      const leader = makeUser({ id: '1', full_name: '李声长', is_section_leader: true })
      const normalA = makeUser({ id: '2', full_name: '阿三' })
      const normalB = makeUser({ id: '3', full_name: '王五' })
      const result = sortGroupMembers([normalB, leader, normalA])
      expect(result.map((u) => u.id)).toEqual(['1', '2', '3'])
    })

    it('多个声部长之间按姓名排序', () => {
      const leaderB = makeUser({ id: '1', full_name: '王部长', is_section_leader: true })
      const leaderA = makeUser({ id: '2', full_name: '陈部长', is_section_leader: true })
      const result = sortGroupMembers([leaderB, leaderA])
      expect(result.map((u) => u.id)).toEqual(['2', '1'])
    })

    it('非声部长按姓名（zh-CN localeCompare）排序', () => {
      const a = makeUser({ id: '1', full_name: '张三' })
      const b = makeUser({ id: '2', full_name: '李四' })
      const c = makeUser({ id: '3', full_name: '阿三' })
      expect(sortGroupMembers([a, b, c]).map((u) => u.id)).toEqual(['3', '2', '1'])
    })

    it('不修改原数组', () => {
      const a = makeUser({ id: '1', full_name: '张三' })
      const b = makeUser({ id: '2', full_name: '李四' })
      const original = [a, b]
      sortGroupMembers(original)
      expect(original.map((u) => u.id)).toEqual(['1', '2'])
    })
  })

  describe('groupProfilesByInstrument', () => {
    it('按 INSTRUMENT_ORDER 顺序分组，未知归入「其他」且排最后', () => {
      const rows = [
        makeUser({ id: '1', full_name: '张三', instrument: '唢呐' }),
        makeUser({ id: '2', full_name: '李四', instrument: '第一小提琴' }),
        makeUser({ id: '3', full_name: '王五', instrument: '大提琴' }),
        makeUser({ id: '4', full_name: '赵六', instrument: null }),
      ]
      const result = groupProfilesByInstrument(rows)
      expect(result.map((g) => g.group)).toEqual(['第一小提琴', '大提琴', OTHER_INSTRUMENT_GROUP])
      const otherGroup = result[result.length - 1]
      expect(otherGroup.users.map((u) => u.id)).toEqual(['1', '4'])
    })

    it('组内声部长排最前', () => {
      const rows = [
        makeUser({ id: '1', full_name: '普通甲', instrument: '第一小提琴' }),
        makeUser({
          id: '2',
          full_name: '声长乙',
          instrument: '第一小提琴',
          is_section_leader: true,
        }),
      ]
      const result = groupProfilesByInstrument(rows)
      expect(result[0].users.map((u) => u.id)).toEqual(['2', '1'])
    })

    it('空数组返回空分组', () => {
      expect(groupProfilesByInstrument([])).toEqual([])
    })
  })
})
