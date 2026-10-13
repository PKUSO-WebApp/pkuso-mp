// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearLegacySessionToken,
  consumeIntentionalSignOut,
  deleteDevice,
  listMyDevices,
  markIntentionalSignOut,
  setDeviceTrust,
  touchSession,
  verifySession,
} from './device-session'

// 内存版 Taro 存储，模拟小程序本地持久化
const { taroMock, store } = vi.hoisted(() => {
  const localStore: Record<string, string> = {}
  const mock = {
    getStorageSync: vi.fn((k: string) => (k in localStore ? localStore[k] : '')),
    setStorageSync: vi.fn((k: string, v: string) => {
      localStore[k] = v
    }),
    removeStorageSync: vi.fn((k: string) => {
      delete localStore[k]
    }),
    // 设备展示名/平台由它提供；不设值时走「未知设备」兜底
    getDeviceInfo: vi.fn(() => undefined),
  }
  return { taroMock: mock, store: localStore }
})
// 默认导入（device-session 的 import Taro from '@tarojs/taro'）与命名导入同源
vi.mock('@tarojs/taro', () => ({ ...taroMock, default: taroMock }))

const rpcMock = vi.fn()
const client: any = { rpc: rpcMock }

beforeEach(() => {
  rpcMock.mockReset()
  Object.keys(store).forEach((k) => delete store[k])
  taroMock.getDeviceInfo.mockClear()
})

describe('touchSession', () => {
  it('带 device_id / 名称 / 平台调用 touch_session_v2', async () => {
    store['pkuso_device_id'] = 'dlocal1234567890'
    rpcMock.mockResolvedValue({ data: [{ token: 't-1', trusted: true }], error: null })
    const res = await touchSession(client)
    expect(res).toEqual({ ok: true, rejected: false })
    expect(rpcMock).toHaveBeenCalledWith('touch_session_v2', {
      p_device_id: 'dlocal1234567890',
      p_name: '未知设备',
      p_platform: '',
    })
  })

  it('device_rejected：明确拒绝（登录方据此撤销会话并提示）', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'device_rejected' } })
    const res = await touchSession(client)
    expect(res).toEqual({ ok: false, rejected: true })
  })

  it('其他错误（网络抖动 / 瞬时鉴权失败）：失败但不判 rejected，不阻断登录', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'fetch failed' } })
    expect(await touchSession(client)).toEqual({ ok: false, rejected: false })
  })

  it('rpc 直接抛错同样不外抛（登录主流程不该被它打断）', async () => {
    rpcMock.mockRejectedValue(new Error('network down'))
    expect(await touchSession(client)).toEqual({ ok: false, rejected: false })
  })
})

describe('verifySession', () => {
  it('本设备这一行 trusted === false ⇒ 被踢（唯一判据），且无墓碑 ⇒ kind = rejected', async () => {
    store['pkuso_device_id'] = 'dlocal1234567890'
    rpcMock.mockResolvedValue({
      data: [
        {
          token: 't-1',
          trusted: false,
          deleted_at: null,
          last_seen_at: '2026-10-13T10:00:00Z',
        },
      ],
      error: null,
    })
    expect(await verifySession(client)).toEqual({ kicked: true, kind: 'rejected' })
    expect(rpcMock).toHaveBeenCalledWith('get_my_session_v2', {
      p_device_id: 'dlocal1234567890',
    })
  })

  it('deleted_at 非空 ⇒ 同样被踢，但 kind = deleted（文案要说「已从账号中移除」）', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          token: 't-1',
          trusted: false,
          deleted_at: '2026-10-14T02:00:00Z',
          last_seen_at: '2026-10-14T01:00:00Z',
        },
      ],
      error: null,
    })
    expect(await verifySession(client)).toEqual({ kicked: true, kind: 'deleted' })
  })

  it('返回体里压根没有 deleted_at 这一列（比数据库旧的服务端）⇒ 判 rejected 而不是漏踢', async () => {
    rpcMock.mockResolvedValue({
      data: [{ token: 't-1', trusted: false, last_seen_at: '2026-10-13T10:00:00Z' }],
      error: null,
    })
    expect(await verifySession(client)).toEqual({ kicked: true, kind: 'rejected' })
  })

  it('trusted === true ⇒ 没被踢（token 变了也不算——它只标识那一行）', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          token: 't-other',
          trusted: true,
          deleted_at: null,
          last_seen_at: '2026-10-13T10:00:00Z',
        },
      ],
      error: null,
    })
    expect(await verifySession(client)).toEqual({ kicked: false, kind: null })
  })

  it('查不到行（新装机 / 换了 device_id）⇒ 保守判没被踢', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })
    expect(await verifySession(client)).toEqual({ kicked: false, kind: null })
  })

  it('查询失败 ⇒ 保守判没被踢（瞬时 401 不能误杀会话）', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await verifySession(client)).toEqual({ kicked: false, kind: null })
  })
})

describe('listMyDevices', () => {
  it('行转成 camelCase，含被设为不信任的那几台', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          device_id: 'd-a',
          name: 'iPhone 13 · iOS 17',
          platform: 'ios',
          trusted: true,
          created_at: '2026-10-01T00:00:00Z',
          last_seen_at: '2026-10-13T10:00:00Z',
        },
        {
          device_id: 'd-b',
          name: 'iPad · iPadOS 17',
          platform: null,
          trusted: false,
          created_at: '2026-10-02T00:00:00Z',
          last_seen_at: '2026-10-12T10:00:00Z',
        },
      ],
      error: null,
    })
    const res = await listMyDevices(client)
    expect(res.ok).toBe(true)
    expect(res.devices).toEqual([
      {
        deviceId: 'd-a',
        name: 'iPhone 13 · iOS 17',
        platform: 'ios',
        trusted: true,
        createdAt: '2026-10-01T00:00:00Z',
        lastSeenAt: '2026-10-13T10:00:00Z',
      },
      {
        deviceId: 'd-b',
        name: 'iPad · iPadOS 17',
        platform: '',
        trusted: false,
        createdAt: '2026-10-02T00:00:00Z',
        lastSeenAt: '2026-10-12T10:00:00Z',
      },
    ])
    expect(rpcMock).toHaveBeenCalledWith('list_my_devices')
  })

  it('查询失败 ⇒ ok:false（页面据此显示错误态，不是空列表）', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await listMyDevices(client)).toEqual({ ok: false, devices: [] })
  })
})

describe('setDeviceTrust', () => {
  it('对别的设备发请求（带自己的 device_id 作 self 判据）', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null })
    expect(await setDeviceTrust(client, 'd-self', 'd-other', false)).toEqual({ ok: true })
    expect(rpcMock).toHaveBeenCalledWith('set_device_trust', {
      p_self_device_id: 'd-self',
      p_device_id: 'd-other',
      p_trusted: false,
    })
  })

  it('目标是本机时**不发请求**（永远不能拒绝自己；服务端也会以 cannot_untrust_self 硬拦）', async () => {
    const res = await setDeviceTrust(client, 'd-self', 'd-self', false)
    expect(res).toEqual({ ok: false, reason: 'cannot_untrust_self' })
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('服务端报错 ⇒ ok:false（页面提示失败）', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'cannot_untrust_self' } })
    expect((await setDeviceTrust(client, 'd-self', 'd-other', false)).ok).toBe(false)
  })
})

describe('deleteDevice', () => {
  it('对别的设备发请求（带自己的 device_id 作 self 判据）', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null })
    expect(await deleteDevice(client, 'd-self', 'd-other')).toEqual({ ok: true })
    expect(rpcMock).toHaveBeenCalledWith('delete_device', {
      p_self_device_id: 'd-self',
      p_device_id: 'd-other',
    })
  })

  it('目标是本机时**零 RPC 调用**（永远不能删除自己；服务端也会以 cannot_block_self 硬拦）', async () => {
    const res = await deleteDevice(client, 'd-self', 'd-self')
    expect(res).toEqual({ ok: false, reason: 'cannot_delete_self' })
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('服务端报错 ⇒ ok:false（页面据此 toast，界面不假装成功）', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'cannot_block_self' } })
    expect((await deleteDevice(client, 'd-self', 'd-other')).ok).toBe(false)
  })

  it('rpc 直接抛错也不外抛', async () => {
    rpcMock.mockRejectedValue(new Error('network down'))
    expect(await deleteDevice(client, 'd-self', 'd-other')).toEqual({ ok: false })
  })
})

describe('本地残留与主动登出标志', () => {
  it('clearLegacySessionToken 删掉旧单设备令牌键', () => {
    store['pkuso_single_session_token'] = 'legacy-token'
    clearLegacySessionToken()
    expect('pkuso_single_session_token' in store).toBe(false)
  })

  it('markIntentionalSignOut / consumeIntentionalSignOut 一次性的语义不变', () => {
    expect(consumeIntentionalSignOut()).toBe(false)
    markIntentionalSignOut()
    expect(consumeIntentionalSignOut()).toBe(true)
    expect(consumeIntentionalSignOut()).toBe(false)
  })
})
