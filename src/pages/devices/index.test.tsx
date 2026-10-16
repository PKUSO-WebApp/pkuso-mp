// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import DevicesPage from './index'

/**
 * 登录设备页：列表三态 + 两个动作（设为不信任 / 删除设备）。
 * 最重要的一条是产品不变量 —— **本机那一行两个入口都不给**（拒绝或删除自己 = 当场把自己
 * 锁在门外，服务端也会以 cannot_untrust_self / cannot_block_self 硬拦）；其次是两个动作
 * 都必须二次确认，且**确认前不发请求**。
 */

const SELF_DEVICE_ID = 'selfdevice0001'

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  kickSelf: vi.fn(),
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

// 「操作前自查发现本机已不可信 ⇒ 直接踢出」用的是 context 里那条强制下线链路
vi.mock('@/context/user-context', () => ({ useUser: () => ({ kickSelf: mocks.kickSelf }) }))

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

/** 取某个 RPC 的调用参数（page 只用三个 RPC：list / set_trust / delete） */
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

/** 同上，但要全部命中（例如「每一行各有一个按钮」时按行取第 N 个） */
const waitForListTexts = async (label: string) => {
  await waitFor(() => expect(listText(label).length).toBeGreaterThan(0))
  return listText(label)
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
    mocks.kickSelf.mockReset()
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

  it('**本机那一行不给任何操作入口**（只有本机一台时界面上没有任何拒绝 / 删除入口）', async () => {
    setDevices([ALL_DEVICES[0]])
    render(<DevicesPage />)
    await waitForListText('本机')
    expect(listText('设为不信任')).toHaveLength(0)
    expect(listText('恢复信任')).toHaveLength(0)
    expect(listText('删除设备')).toHaveLength(0)
  })

  it('别的设备才有「设为不信任」；被拒的那台显示「恢复信任」', async () => {
    render(<DevicesPage />)
    await waitForListText('小米 14 · Android 15')
    // 三台设备：本机（无入口）、另一台已信任（设为不信任）、一台被拒（恢复信任）
    expect(listText('设为不信任')).toHaveLength(1)
    expect(listText('恢复信任')).toHaveLength(1)
  })

  it('「删除设备」只出现在非本机行（两台非本机设备各一个，本机那行没有）', async () => {
    render(<DevicesPage />)
    await waitForListText('小米 14 · Android 15')
    expect(listText('删除设备')).toHaveLength(2)
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

  it('删除设备：二次确认前不发请求，确认后带本机 id 发；成功后该行从列表消失', async () => {
    // 服务端行为的最小仿真：delete_device 之后 list_my_devices 不再返回那一行
    let rows = [...ALL_DEVICES]
    mocks.rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
      if (fn === 'list_my_devices') return { data: rows, error: null }
      if (fn === 'delete_device') {
        rows = rows.filter((row) => row.device_id !== args?.p_device_id)
        return { data: null, error: null }
      }
      return { data: null, error: null }
    })
    render(<DevicesPage />)
    fireEvent.click((await waitForListTexts('删除设备'))[0])

    // 弹窗打开且写清了后果（立刻下线 / 从列表消失 / 下次登录当新设备）；此刻**一个请求都没发**
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('这台设备会立即下线，并从列表中消失')
    expect(dialog.textContent).toContain('会被当作新设备')
    expect(rpcArgs('delete_device')).toHaveLength(0)
    // 只断言**列表里**那一行还在（弹窗正文里也印着同一个设备名）
    expect(listText('小米 14 · Android 15')).toHaveLength(1)

    fireEvent.click(screen.getByText('删除'))
    await waitFor(() => expect(rpcArgs('delete_device')).toHaveLength(1))
    expect(rpcArgs('delete_device')[0]).toEqual({
      p_self_device_id: SELF_DEVICE_ID,
      p_device_id: 'otherdevice001',
    })
    // 列表以服务端为准重新取：那一行消失（另一台非本机设备还在，入口还剩一个）
    await waitFor(() => expect(listText('小米 14 · Android 15')).toHaveLength(0))
    expect(listText('删除设备')).toHaveLength(1)
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith({ title: '设备已删除', icon: 'success' })
    )
  })

  it('删除失败：toast 提示，界面不假装成功（那一行还在）', async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'list_my_devices') return { data: ALL_DEVICES, error: null }
      return { data: null, error: { message: 'rls' } }
    })
    render(<DevicesPage />)
    fireEvent.click((await waitForListTexts('删除设备'))[0])
    fireEvent.click(screen.getByText('删除'))

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith({ title: '删除失败，请重试', icon: 'none' })
    )
    expect(listText('小米 14 · Android 15')).toHaveLength(1)
    expect(listText('删除设备')).toHaveLength(2)
  })

  it('确认弹窗上的「取消」不发请求（删除必须由用户明确确认）', async () => {
    render(<DevicesPage />)
    fireEvent.click((await waitForListTexts('删除设备'))[0])
    // 「取消」两个弹窗里都有（另一个只是 display:none），所以按「当前打开的那个」取
    fireEvent.click(within(screen.getByRole('dialog')).getByText('取消'))

    expect(rpcArgs('delete_device')).toHaveLength(0)
    // 弹窗已关闭（display:none 的节点不进可访问树）
    expect(screen.queryByRole('dialog')).toBeNull()
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

  // 规则 C（用户 2026-10-16 定）：做设备管理前先查发起方自己还在不在受信名单里，
  // 发现自己已被设为不信任 / 已删除就**直接踢出**，而不是继续点、每次吃一个「操作失败」。
  it('操作前自查发现本机已被设为不信任 ⇒ 直接踢出，且一个管理请求都不发', async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'list_my_devices') return { data: ALL_DEVICES, error: null }
      // get_my_session_v2：本机这一行 trusted = false 且无墓碑 ⇒ 被设为不信任
      if (fn === 'get_my_session_v2') return { data: [{ trusted: false, deleted_at: null }], error: null }
      return { data: null, error: null }
    })
    render(<DevicesPage />)
    fireEvent.click(await waitForListText('恢复信任'))

    await waitFor(() => expect(mocks.kickSelf).toHaveBeenCalledWith('rejected'))
    expect(rpcArgs('set_device_trust')).toHaveLength(0)
  })

  it('操作前自查发现本机已被删除 ⇒ 按「被删除」踢出（弹窗文案据此选）', async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'list_my_devices') return { data: ALL_DEVICES, error: null }
      if (fn === 'get_my_session_v2')
        return { data: [{ trusted: false, deleted_at: '2026-10-16T00:00:00Z' }], error: null }
      return { data: null, error: null }
    })
    render(<DevicesPage />)
    fireEvent.click(await waitForListText('恢复信任'))

    await waitFor(() => expect(mocks.kickSelf).toHaveBeenCalledWith('deleted'))
    expect(rpcArgs('set_device_trust')).toHaveLength(0)
  })

  it('服务端拒绝 caller_not_trusted（自查之后、RPC 之前被踢）⇒ 踢出', async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'list_my_devices') return { data: ALL_DEVICES, error: null }
      // 自查那一刻本机还受信
      if (fn === 'get_my_session_v2') return { data: [{ trusted: true, deleted_at: null }], error: null }
      if (fn === 'set_device_trust') return { data: null, error: { message: 'caller_not_trusted' } }
      return { data: null, error: null }
    })
    render(<DevicesPage />)
    fireEvent.click(await waitForListText('恢复信任'))

    await waitFor(() => expect(mocks.kickSelf).toHaveBeenCalled())
    // 不是「操作失败」那种普通失败
    expect(mocks.showToast).not.toHaveBeenCalledWith({ title: '操作失败，请重试', icon: 'none' })
  })
})
