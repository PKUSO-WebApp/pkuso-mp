import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasStoredAuthSession } from './auth-storage'

const { taroMock } = vi.hoisted(() => ({
  taroMock: {
    getStorageInfoSync: vi.fn(),
  },
}))

vi.mock('@tarojs/taro', () => ({ default: taroMock }))

describe('hasStoredAuthSession', () => {
  beforeEach(() => {
    taroMock.getStorageInfoSync.mockReset()
  })

  it('存在 Supabase 会话键 → true', () => {
    taroMock.getStorageInfoSync.mockReturnValue({
      keys: ['pkuso-ui-scale', 'sb-abcdefghijklmnop-auth-token'],
    })
    expect(hasStoredAuthSession()).toBe(true)
  })

  it('只有其他键 / code-verifier 键 → false', () => {
    taroMock.getStorageInfoSync.mockReturnValue({
      keys: ['pkuso-ui-scale', 'sb-abcdefghijklmnop-auth-token-code-verifier'],
    })
    expect(hasStoredAuthSession()).toBe(false)
  })

  it('存储不可用时按「没有会话」处理（不误报确认中）', () => {
    taroMock.getStorageInfoSync.mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    expect(hasStoredAuthSession()).toBe(false)
  })
})
