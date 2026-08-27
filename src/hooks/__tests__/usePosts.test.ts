// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePosts } from '../usePosts'

// 模块加载即校验环境变量，直接 mock 掉 supabase 模块（测试显式传 client，默认值不被使用）
vi.mock('@/lib/supabase', () => ({
  supabase: {},
}))

function mockClient<T>(responses: T[]) {
  let i = 0
  const chain = (res: T) => ({
    eq: () => chain(res),
    in: () => chain(res),
    order: () => chain(res),
    limit: () => chain(res),
    delete: () => chain(res),
    select: () => chain(res),
    single: () => res,
    then: (resolve: (v: T) => void) => resolve(res),
  })
  return {
    from: () => ({
      select: () => chain(responses[i++]),
      insert: () => chain(responses[i++]),
      update: () => ({ eq: () => chain(responses[i++]) }),
      delete: () => ({ eq: () => chain(responses[i++]) }),
    }),
  }
}

describe('usePosts', () => {
  afterEach(() => {
    cleanup()
  })

  it('fetch 公告列表并归一化 profiles（对象形态）', async () => {
    const c = mockClient([
      {
        data: [
          {
            id: '1',
            title: '重奏招募',
            type: 'ensemble',
            content: '欢迎报名',
            image_url: null,
            author_id: 'u1',
            created_at: '2026-08-20T10:00:00',
            contact_info: null,
            current_sections: null,
            missing_sections: '双簧管',
            is_locked: false,
            profiles: { full_name: '张三', instrument: '长笛' },
          },
        ],
        error: null,
      },
    ])
    const { result } = renderHook(() => usePosts(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data[0].profiles?.full_name).toBe('张三')
    expect(result.current.error).toBeNull()
  })

  it('fetch 空数据', async () => {
    const c = mockClient([{ data: [], error: null }])
    const { result } = renderHook(() => usePosts(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('fetch 失败：错误归一化为中文文案，清空列表', async () => {
    const c = mockClient([{ data: null, error: { message: 'connection refused' } }])
    const { result } = renderHook(() => usePosts(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('loadFailed')
    expect(result.current.data).toEqual([])
  })

  it('卸载后手动 fetch 不再发起请求（mountedRef 拦截 setState）', async () => {
    let selectCount = 0
    const chain = (res: unknown) => ({
      eq: () => chain(res),
      order: () => chain(res),
      select: () => chain(res),
      single: () => res,
      then: (resolve: (v: unknown) => void) => resolve(res),
    })
    const c = {
      from: () => ({
        select: () => {
          selectCount += 1
          return chain({ data: [{ id: '1' }], error: null })
        },
        insert: () => chain({ data: null, error: null }),
        update: () => ({ eq: () => chain({ data: null, error: null }) }),
        delete: () => ({ eq: () => chain({ data: null, error: null }) }),
      }),
    }
    const { result, unmount } = renderHook(() => usePosts(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    unmount()

    await act(async () => {
      await result.current.fetch()
    })
    expect(selectCount).toBe(1)
  })
})
