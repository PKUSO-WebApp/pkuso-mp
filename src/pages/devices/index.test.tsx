// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import DevicesPage from './index'

/**
 * 登录设备页：列表三态 + 两个动作。
 * 最重要的一条是产品不变量 —— **本机那一行不给「设为不信任」入口**（拒绝自己 = 当场把自己
 * 锁在门外，服务端也会以 cannot_untrust_self 硬拦）；其次是「设为不信任」必须二次确认。
 */

const SELF_DEVICE_ID = 'selfdevice0001'

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  rpc: vi.fn(
    async (
      _fn: string,
      _args?: Record<string, unknown>
    ): Promise<{ data: unknown; error: unknown }> => ({ data: [], error: null })
  ),
}))

vi.mock('@tarojs/components', () => {
  const create = (tag: string) => (props: Record<string, unknown>) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return {
    View: create('div'),
    Text: create('span'),
    Button: create('button'),
    ScrollView: create('div'),
  }
})

vi.mock('@tarojs/taro', () => ({
  default: {
    showToast: mocks.showToast,
    // device-id 的持久化：返回固定值，本机那一行才能与列表里的行对上
    getStorageSync: (key: string) => (key === 'pkuso_device_id' ? 'selfdevice0001' : ''),
    setStorageSync: vi.fn(),
    getDeviceInfo: () => ({ model: 'iPhone 13', system: 'iOS 17.0', platform: 'ios' }),
  },
  // 前台切换重取：本文件只测初次加载与动作，置为空实现保持调用次数可判定
  useDidShow: vi.fn(),
}))

vi.mock('@/context/theme-context', () => ({ useThemeClass: () => '' }))

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))

vi.mock('@/i18n', async () => {
  const mod = await import('@/i18n/messages/zh-CN')
  const dict = mod.zhCN as Record<string, unknown>
  const get = (k: string, p?: Record<string, unknown>): string => {
    const val = k
      .split('.')
      .reduce<unknown>(
        (o, key) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[key] : undefined),
        dict
      )
    let s = typeof val === 'string' ? val : k
    if (p)
      s = s.replace(/\{(\w+)\}/g, (_, key) => (p[key] !== undefined ? String(p[key]) : `{${key}}`))
    return s
  }
  // ⚠️ t 必须是**稳定引用**：页面的 load 以它作 useCallback 依赖、又被 useEffect 依赖，
  // 每次渲染换一个新函数 = effect 无限重跑（页面永远停在 loading，且不报错）
  const t = (k: string, p?: Record<string, unknown>) => get(k, p)
  return {
    useT: () => ({ t, locale: 'zh-CN', setLocale: vi.fn() }),
    useNavTitle: vi.fn(),
  }
})

const deviceRow = (deviceId: string, name: string, trusted: boolean, lastSeenAt: string) => ({
  device_id: deviceId,
  name,
  platform: 'ios',
  trusted,
  created_at: '2026-10-01T02:00:00Z',
  last_seen_at: lastSeenAt,
})

/** 服务端顺序：已信任优先、同组按最后活跃倒序（客户端不再排） */
const ALL_DEVICES = [
  deviceRow(SELF_DEVICE_ID, 'iPhone 13 · iOS 17.0', true, '2026-10-13T02:00:00Z'),
  deviceRow('otherdevice001', '小米 14 · Android 15', true, '2026-10-12T02:00:00Z'),
  deviceRow('blockeddevice01', 'iPad Air · iPadOS 18.0', false, '2026-10-10T02:00:00Z'),
]

/** 取某个 RPC 的调用参数（page 只用两个 RPC） */
const rpcArgs = (fnName: string) =>
  mocks.rpc.mock.calls.filter((call) => call[0] === fnName).map((call) => call[1])

/**
 * 只在**列表里**找文案：确认弹窗的标题与按钮和列表用词相同，而 Modal 是「始终渲染、
 * 用 display 控制显隐」的 —— 不排除 [role=dialog] 的话，隐藏弹窗里的节点会被当成列表内容
 * （`getByRole('dialog')` 反过来又会因为 display:none 而找不到它）。
 */
const listText = (label: string) =>
  screen.queryAllByText(label).filter((el) => el.closest('[role="dialog"]') === null)

/** 等列表里的文案出现（初次加载是异步的） */
const waitForListText = async (label: string) => {
  await waitFor(() => expect(listText(label).length).toBeGreaterThan(0))
  return listText(label)[0]
}

const setDevices = (rows: unknown[]) => {
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === 'list_my_devices') return { data: rows, error: null }
    return { data: null, error: null }
  })
}

describe('DevicesPage', () => {
  beforeEach(() => {
    mocks.showToast.mockReset()
    mocks.rpc.mockReset()
    setDevices(ALL_DEVICES)
  })

  afterEach(() => cleanup())

  it('渲染设备名、本机标记与被拒标记', async () => {
    render(<DevicesPage />)
    expect(await screen.findByText('小米 14 · Android 15')).toBeTruthy()
    expect(screen.getByText('iPhone 13 · iOS 17.0')).toBeTruthy()
    expect(screen.getByText('本机')).toBeTruthy()
    expect(screen.getByText('已拒绝登录')).toBeTruthy()
  })

  it('**本机那一行不给「设为不信任」入口**（只有本机一台时界面上没有任何拒绝入口）', async () => {
    setDevices([ALL_DEVICES[0]])
    render(<DevicesPage />)
    await waitForListText('本机')
    expect(listText('设为不信任')).toHaveLength(0)
    expect(listText('恢复信任')).toHaveLength(0)
  })

  it('别的设备才有「设为不信任」；被拒的那台显示「恢复信任」', async () => {
    render(<DevicesPage />)
    await waitForListText('小米 14 · Android 15')
    // 三台设备：本机（无入口）、另一台已信任（设为不信任）、一台被拒（恢复信任）
    expect(listText('设为不信任')).toHaveLength(1)
    expect(listText('恢复信任')).toHaveLength(1)
  })

  it('设为不信任必须二次确认：确认前不发请求，确认后带本机 id 发', async () => {
    render(<DevicesPage />)
    fireEvent.click(await waitForListText('设为不信任'))

    // 弹窗已打开（Modal 用 display 控制显隐，节点始终在；关闭时 getByRole 找不到它）
    expect(screen.getByRole('dialog').getAttribute('style')).toContain('display: flex')
    expect(rpcArgs('set_device_trust')).toHaveLength(0)

    fireEvent.click(screen.getByText('确定'))
    await waitFor(() => expect(rpcArgs('set_device_trust')).toHaveLength(1))
    expect(rpcArgs('set_device_trust')[0]).toEqual({
      p_self_device_id: SELF_DEVICE_ID,
      p_device_id: 'otherdevice001',
      p_trusted: false,
    })
  })

  it('恢复信任是安全方向：点一下直接发（无需确认）', async () => {
    render(<DevicesPage />)
    fireEvent.click(await waitForListText('恢复信任'))

    await waitFor(() => expect(rpcArgs('set_device_trust')).toHaveLength(1))
    expect(rpcArgs('set_device_trust')[0]).toEqual({
      p_self_device_id: SELF_DEVICE_ID,
      p_device_id: 'blockeddevice01',
      p_trusted: true,
    })
  })

  it('列表失败显示错误与重试，重试成功后渲染列表', async () => {
    let first = true
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn !== 'list_my_devices') return { data: null, error: null }
      if (first) {
        first = false
        return { data: null, error: { message: 'network' } }
      }
      return { data: ALL_DEVICES, error: null }
    })
    render(<DevicesPage />)
    expect(await screen.findByText('加载失败，请重试')).toBeTruthy()

    fireEvent.click(screen.getByText('重试'))
    expect(await screen.findByText('小米 14 · Android 15')).toBeTruthy()
  })

  it('动作失败：提示操作失败（界面不假装成功）', async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'list_my_devices') return { data: ALL_DEVICES, error: null }
      return { data: null, error: { message: 'rls' } }
    })
    render(<DevicesPage />)
    fireEvent.click(await waitForListText('恢复信任'))
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith({ title: '操作失败，请重试', icon: 'none' })
    )
  })
})
