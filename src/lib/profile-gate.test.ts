import { describe, expect, it } from 'vitest'
import {
  isSyntheticEmail,
  needsProfileSetup,
  resolveEntryRoute,
  type EntryProfile,
} from './profile-gate'

const makeProfile = (overrides: Partial<EntryProfile> = {}): EntryProfile => ({
  full_name: '张三',
  email: 'zhangsan@example.com',
  status: 'approved',
  ...overrides,
})

describe('isSyntheticEmail', () => {
  it('微信合成邮箱识别（placeholder.local 后缀）', () => {
    expect(isSyntheticEmail('wechat_abc@placeholder.local')).toBe(true)
  })

  it('真实邮箱不视为合成', () => {
    expect(isSyntheticEmail('zhangsan@example.com')).toBe(false)
  })

  it('空值/null 不视为合成', () => {
    expect(isSyntheticEmail('')).toBe(false)
    expect(isSyntheticEmail(null)).toBe(false)
    expect(isSyntheticEmail(undefined)).toBe(false)
  })
})

describe('needsProfileSetup', () => {
  it('姓名缺失 → 需补全', () => {
    expect(needsProfileSetup(makeProfile({ full_name: '' }))).toBe(true)
    expect(needsProfileSetup(makeProfile({ full_name: '  ' }))).toBe(true)
    expect(needsProfileSetup(makeProfile({ full_name: null }))).toBe(true)
  })

  it('邮箱缺失 → 需补全', () => {
    expect(needsProfileSetup(makeProfile({ email: '' }))).toBe(true)
    expect(needsProfileSetup(makeProfile({ email: null }))).toBe(true)
  })

  it('邮箱为微信合成邮箱 → 需补全（用户未填过真实邮箱）', () => {
    expect(needsProfileSetup(makeProfile({ email: 'wechat_abc@placeholder.local' }))).toBe(true)
  })

  it('资料完整 → 无需补全', () => {
    expect(needsProfileSetup(makeProfile())).toBe(false)
  })

  it('profile 为 null/undefined → 无需补全（由 resolveEntryRoute 处理空态）', () => {
    expect(needsProfileSetup(null)).toBe(false)
    expect(needsProfileSetup(undefined)).toBe(false)
  })
})

describe('resolveEntryRoute', () => {
  it('资料不完整 → 资料补全页（优先于审核状态）', () => {
    expect(resolveEntryRoute(makeProfile({ full_name: '', status: 'pending' }))).toBe(
      '/pages/setup/index'
    )
    expect(resolveEntryRoute(makeProfile({ email: 'wechat_abc@placeholder.local' }))).toBe(
      '/pages/setup/index'
    )
  })

  it('pending → 等待审核守卫页', () => {
    expect(resolveEntryRoute(makeProfile({ status: 'pending' }))).toBe('/pages/pending/index')
  })

  it('status 为 null → 按 pending 处理（触发器理论总会写入 pending）', () => {
    expect(resolveEntryRoute(makeProfile({ status: null }))).toBe('/pages/pending/index')
  })

  it('rejected → 审核未通过页', () => {
    expect(resolveEntryRoute(makeProfile({ status: 'rejected' }))).toBe('/pages/rejected/index')
  })

  it('approved → 首页', () => {
    expect(resolveEntryRoute(makeProfile({ status: 'approved' }))).toBe('/pages/index/index')
  })

  it('profile 为 null/undefined → null（调用方决定落点）', () => {
    expect(resolveEntryRoute(null)).toBeNull()
    expect(resolveEntryRoute(undefined)).toBeNull()
  })
})
