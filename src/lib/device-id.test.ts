// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

// 内存版 Taro 存储 + 可切换的 getDeviceInfo
const { taroMock, store, deviceInfo } = vi.hoisted(() => {
  const localStore: Record<string, string> = {}
  const info: { value: unknown; throws: boolean } = { value: undefined, throws: false }
  const mock = {
    getStorageSync: vi.fn((k: string) => (k in localStore ? localStore[k] : '')),
    setStorageSync: vi.fn((k: string, v: string) => {
      localStore[k] = v
    }),
    removeStorageSync: vi.fn((k: string) => {
      delete localStore[k]
    }),
    getDeviceInfo: vi.fn(() => {
      if (info.throws) throw new Error('no device info')
      return info.value
    }),
  }
  return { taroMock: mock, store: localStore, deviceInfo: info }
})
// 默认导入（device-id 的 import Taro from '@tarojs/taro'）与命名导入同源
vi.mock('@tarojs/taro', () => ({ ...taroMock, default: taroMock }))

// 每个用例重新加载模块：memoryDeviceId 是模块级状态，不重置会串味
type DeviceIdModule = typeof import('./device-id')
let mod: DeviceIdModule

beforeEach(async () => {
  vi.resetModules()
  Object.keys(store).forEach((k) => delete store[k])
  taroMock.getStorageSync
    .mockReset()
    .mockImplementation((k: string) => (k in store ? store[k] : ''))
  taroMock.setStorageSync.mockReset().mockImplementation((k: string, v: string) => {
    store[k] = v
  })
  taroMock.getDeviceInfo.mockClear()
  deviceInfo.value = undefined
  deviceInfo.throws = false
  mod = await import('./device-id')
})

describe('device-id', () => {
  it('createDeviceId 生成的值满足服务端约束（8~64 字符、URL 安全）', () => {
    const id = mod.createDeviceId()
    expect(id.length).toBeGreaterThanOrEqual(8)
    expect(id.length).toBeLessThanOrEqual(64)
    expect(id).toMatch(/^[a-z0-9]+$/)
  })

  it('createDeviceId 两次生成不同（同一毫秒也靠随机段区分）', () => {
    expect(mod.createDeviceId()).not.toBe(mod.createDeviceId())
  })

  it('getOrCreateDeviceId 首次生成并持久化，再调用返回同一个值', () => {
    const first = mod.getOrCreateDeviceId()
    expect(store['pkuso_device_id']).toBe(first)
    expect(mod.getOrCreateDeviceId()).toBe(first)
    // 第二次读的是存储，不再重写
    expect(taroMock.setStorageSync).toHaveBeenCalledTimes(1)
  })

  it('存储里已有合法 id 时直接复用（不重新生成）', () => {
    store['pkuso_device_id'] = 'dexisting12345678'
    expect(mod.getOrCreateDeviceId()).toBe('dexisting12345678')
    expect(taroMock.setStorageSync).not.toHaveBeenCalled()
  })

  it('存坏的 id（过短）会被重新生成——服务端有长度约束，坏值会让登录直接失败', () => {
    store['pkuso_device_id'] = 'short'
    const id = mod.getOrCreateDeviceId()
    expect(id).not.toBe('short')
    expect(id.length).toBeGreaterThanOrEqual(8)
    expect(store['pkuso_device_id']).toBe(id)
  })

  it('存储读写都不可用时仍在本次运行内保持稳定（只靠进程内兜底）', () => {
    taroMock.getStorageSync.mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    taroMock.setStorageSync.mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    const first = mod.getOrCreateDeviceId()
    expect(first.length).toBeGreaterThanOrEqual(8)
    expect(mod.getOrCreateDeviceId()).toBe(first)
  })

  describe('getDeviceName / getDevicePlatform', () => {
    it('拼成「机型 · 系统」', () => {
      deviceInfo.value = { model: 'iPhone 13', system: 'iOS 17.0', platform: 'ios' }
      expect(mod.getDeviceName()).toBe('iPhone 13 · iOS 17.0')
      expect(mod.getDevicePlatform()).toBe('ios')
    })

    it('只有机型时只用机型（不留空的「· 」）', () => {
      deviceInfo.value = { model: 'iPad', system: '', platform: 'ios' }
      expect(mod.getDeviceName()).toBe('iPad')
    })

    it('取不到设备信息时回退「未知设备」/ 空平台', () => {
      deviceInfo.value = undefined
      expect(mod.getDeviceName()).toBe('未知设备')
      expect(mod.getDevicePlatform()).toBe('')
    })

    it('getDeviceInfo 抛错时同样回退，不外抛', () => {
      deviceInfo.throws = true
      expect(mod.getDeviceName()).toBe('未知设备')
      expect(mod.getDevicePlatform()).toBe('')
    })
  })
})
