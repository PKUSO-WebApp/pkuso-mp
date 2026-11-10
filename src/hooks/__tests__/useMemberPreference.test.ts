// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMemberPreference } from '../useMemberPreference'

const { rpcMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: rpcMock, from: fromMock },
}))

function mockData(opts: {
  canSet?: boolean
  value?: number | null
  groups?: string[]
  observed?: number[]
}) {
  const { canSet = true, value = null, groups = [], observed = [] } = opts
  fromMock.mockImplementation((table: string) => {
    if (table === 'section_member_preferences') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: value == null ? null : { preferred_sub_part: value },
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === 'section_group_members') {
      return {
        select: () => ({
          eq: async () => ({
            data: groups.map((group_name) => ({ group_name })),
            error: null,
          }),
        }),
      }
    }
    if (table === 'sheet_music_parts') {
      return {
        select: () => ({
          eq: async () => ({
            data: [{ files: [{ sub_parts: observed }] }],
            error: null,
          }),
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
  rpcMock.mockImplementation((name: string) => {
    if (name === 'can_set_preference') return Promise.resolve({ data: canSet, error: null })
    if (name === 'set_member_preference') return Promise.resolve({ data: null, error: null })
    throw new Error(`unexpected rpc ${name}`)
  })
}

beforeEach(() => {
  rpcMock.mockReset()
  fromMock.mockReset()
})
afterEach(() => cleanup())

describe('useMemberPreference', () => {
  it('首次：并行取权限/值/类别/可用号', async () => {
    mockData({ canSet: true, value: 2, groups: ['铜管'], observed: [1, 2, 5] })
    const { result } = renderHook(() =>
      useMemberPreference({ ownerId: 'o1', memberId: 'm1', instrument: '圆号' })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({
      canSet: true,
      value: 2,
      groups: ['铜管'],
      observedNumbers: [1, 2, 5],
    })
  })

  it('重进：缓存命中时首帧就有数据（不必等网络）', async () => {
    mockData({ canSet: true, value: 3, groups: ['木管'] })
    const first = renderHook(() =>
      useMemberPreference({ ownerId: 'o2', memberId: 'm2', instrument: '长笛' })
    )
    await waitFor(() => expect(first.result.current.data?.value).toBe(3))
    first.unmount()

    // 网络挂起：模拟「后台核对还没回来」，首帧仍应来自缓存
    fromMock.mockImplementation((table: string) =>
      table === 'section_member_preferences'
        ? { select: () => ({ eq: () => ({ maybeSingle: () => new Promise(() => {}) }) }) }
        : { select: () => ({ eq: () => new Promise(() => {}) }) }
    )
    const second = renderHook(() =>
      useMemberPreference({ ownerId: 'o2', memberId: 'm2', instrument: '长笛' })
    )

    expect(second.result.current.data?.value).toBe(3)
    expect(second.result.current.loading).toBe(false)
  })

  it('保存后立即可见，且下一次进入命中新值', async () => {
    mockData({ canSet: true, value: null, groups: ['铜管'] })
    const first = renderHook(() =>
      useMemberPreference({ ownerId: 'o3', memberId: 'm3', instrument: '小号' })
    )
    await waitFor(() => expect(first.result.current.loading).toBe(false))

    await act(async () => {
      const ok = await first.result.current.save(4)
      expect(ok).toBe(true)
    })
    expect(first.result.current.data?.value).toBe(4)
    first.unmount()

    fromMock.mockImplementation((table: string) =>
      table === 'section_member_preferences'
        ? { select: () => ({ eq: () => ({ maybeSingle: () => new Promise(() => {}) }) }) }
        : { select: () => ({ eq: () => new Promise(() => {}) }) }
    )
    const second = renderHook(() =>
      useMemberPreference({ ownerId: 'o3', memberId: 'm3', instrument: '小号' })
    )
    expect(second.result.current.data?.value).toBe(4)
  })

  it('无写权：canSet=false 原样带回（显隐由页面决定）', async () => {
    mockData({ canSet: false, value: 2, groups: ['弦乐'] })
    const { result } = renderHook(() =>
      useMemberPreference({ ownerId: 'o4', memberId: 'm4', instrument: '中提琴' })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data?.canSet).toBe(false)
  })
})
