import { describe, expect, it } from 'vitest'
import type { ProfileRole } from '@/types/database'
import { isOrchestraMember } from './role-gate'

describe('isOrchestraMember', () => {
  it('只有 member 是团员；admin 与谱务账号都不是', () => {
    expect(isOrchestraMember('member')).toBe(true)
    expect(isOrchestraMember('admin')).toBe(false)
    expect(isOrchestraMember('score_manager')).toBe(false)
  })

  it('role 为空按列默认值 member 算', () => {
    // 列上没有 NOT NULL。空值必须按 member 算：写 `?? ''` 会让 role 为空的老账号
    // 既进不去页面、又从花名册里静默消失
    expect(isOrchestraMember(null)).toBe(true)
    expect(isOrchestraMember(undefined)).toBe(true)
  })

  it('类型之外的角色一律失败关闭 —— 包括空串', () => {
    // 数据库先于类型同步加了角色时，运行时会走到这里
    expect(isOrchestraMember('librarian' as ProfileRole)).toBe(false)
    // 空串不是「没填」，它是脏数据：按失败关闭处理，别把它当 member
    expect(isOrchestraMember('' as ProfileRole)).toBe(false)
  })
})
