// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routeAfterLogin } from './post-auth-route'
import type { EntryProfile } from './profile-gate'

const { taroMock } = vi.hoisted(() => {
  const mock = { reLaunch: vi.fn() }
  ;(mock as unknown as Record<string, unknown>).default = mock
  return { taroMock: mock }
})
vi.mock('@tarojs/taro', () => taroMock)

// 模块加载即校验环境变量，直接 mock 掉 supabase 模块（测试显式传 client）
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

/** 构造最小 client：rpc('get_my_profile_entry') 返回给定 profile 数组 */
function mockClient(profile: EntryProfile | null, error: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data: profile ? [profile] : [], error })
  return { rpc }
}

describe('routeAfterLogin', () => {
  beforeEach(() => {
    taroMock.reLaunch.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('经 RPC get_my_profile_entry 读取本人入口字段', async () => {
    const client = mockClient({ full_name: '张三', email: 'a@b.com', status: 'approved' })
    await routeAfterLogin(client as never)
    expect(client.rpc).toHaveBeenCalledWith('get_my_profile_entry')
  })

  it('资料不完整 → 资料补全页', async () => {
    const client = mockClient({
      full_name: '',
      email: 'wechat_abc@placeholder.local',
      status: 'pending',
    })
    await routeAfterLogin(client as never)
    expect(taroMock.reLaunch).toHaveBeenCalledWith({ url: '/pages/setup/index' })
  })

  it('pending → 等待审核页', async () => {
    const client = mockClient({ full_name: '张三', email: 'a@b.com', status: 'pending' })
    await routeAfterLogin(client as never)
    expect(taroMock.reLaunch).toHaveBeenCalledWith({ url: '/pages/pending/index' })
  })

  it('rejected → 审核未通过页', async () => {
    const client = mockClient({ full_name: '张三', email: 'a@b.com', status: 'rejected' })
    await routeAfterLogin(client as never)
    expect(taroMock.reLaunch).toHaveBeenCalledWith({ url: '/pages/rejected/index' })
  })

  it('approved → 首页', async () => {
    const client = mockClient({ full_name: '张三', email: 'a@b.com', status: 'approved' })
    await routeAfterLogin(client as never)
    expect(taroMock.reLaunch).toHaveBeenCalledWith({ url: '/pages/index/index' })
  })

  it('RPC 返回错误 → 降级到等待审核守卫页（不放未审核用户进首页）', async () => {
    const client = mockClient(null, { message: 'network error' })
    await routeAfterLogin(client as never)
    expect(taroMock.reLaunch).toHaveBeenCalledWith({ url: '/pages/pending/index' })
  })

  it('RPC 返回空数组（无 profile 行）→ 降级到等待审核守卫页', async () => {
    const client = mockClient(null)
    await routeAfterLogin(client as never)
    expect(taroMock.reLaunch).toHaveBeenCalledWith({ url: '/pages/pending/index' })
  })
})
