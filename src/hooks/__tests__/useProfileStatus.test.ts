// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProfileStatus } from '../useProfileStatus'

const { userCtx, mockT } = vi.hoisted(() => ({
  userCtx: { user: null as { id: string } | null },
  mockT: (k: string) => k,
}))
vi.mock('@/context/user-context', () => ({ useUser: () => userCtx }))

vi.mock('@/i18n', () => ({
  useT: () => ({ t: mockT, locale: 'zh-CN', setLocale: vi.fn() }),
}))

// 模块加载即校验环境变量，mock 掉 supabase 模块（测试显式传 client）
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

type Row = { full_name: string; email: string; status: string }

/** 构造最小 client：rpc('get_my_profile_entry') 依调用次序返回给定响应 */
function mockClient(responses: Array<{ data: Row[]; error: { message: string } | null }>) {
  let call = 0
  const rpc = vi.fn(() => Promise.resolve(responses[Math.min(call++, responses.length - 1)]))
  return { rpc }
}

describe('useProfileStatus', () => {
  beforeEach(() => {
    userCtx.user = { id: 'u1' }
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('挂载后经 RPC get_my_profile_entry 查询本人 profile', async () => {
    const client = mockClient([
      { data: [{ full_name: '张三', email: 'a@b.com', status: 'pending' }], error: null },
    ])
    const { result } = renderHook(() => useProfileStatus(client as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(client.rpc).toHaveBeenCalledWith('get_my_profile_entry')
    expect(result.current.profile?.status).toBe('pending')
    expect(result.current.error).toBeNull()
  })

  it('查询失败：归一化为网络错误文案', async () => {
    const client = mockClient([{ data: [], error: null }])
    client.rpc.mockRejectedValue(new Error('fetch failed'))
    const { result } = renderHook(() => useProfileStatus(client as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('common.errors.loadFailed')
    expect(result.current.profile).toBeNull()
  })

  it('查询返回错误对象：透传错误信息', async () => {
    const client = mockClient([{ data: [], error: { message: 'boom' } }])
    const { result } = renderHook(() => useProfileStatus(client as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('boom')
  })

  it('refresh 重查：采纳最新一次查询结果（竞态守卫）', async () => {
    // 第一次查询挂起，refresh 的第二次查询先返回 → 只采纳第二次结果
    type RpcResponse = { data: Row[]; error: { message: string } | null }
    let resolveFirst!: (value: RpcResponse) => void
    const first: Promise<RpcResponse> = new Promise((resolve) => {
      resolveFirst = resolve
    })
    const client = mockClient([
      { data: [{ full_name: '旧', email: 'a@b.com', status: 'pending' }], error: null },
    ])
    client.rpc.mockImplementationOnce(() => first)
    const { result } = renderHook(() => useProfileStatus(client as never))

    let refreshPromise!: Promise<void>
    act(() => {
      refreshPromise = result.current.refresh()
    })
    await act(async () => {
      resolveFirst({
        data: [{ full_name: '旧', email: 'a@b.com', status: 'pending' }],
        error: null,
      })
      await refreshPromise
    })
    // 第二次（refresh）查询返回 pending；旧查询后到时被序号守卫丢弃
    expect(client.rpc).toHaveBeenCalledTimes(2)
    expect(result.current.profile?.status).toBe('pending')
  })

  it('user 为 null：不发起查询', () => {
    userCtx.user = null
    const client = mockClient([{ data: [], error: null }])
    renderHook(() => useProfileStatus(client as never))
    expect(client.rpc).not.toHaveBeenCalled()
  })
})
