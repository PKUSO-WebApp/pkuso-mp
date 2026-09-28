import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getStorageSync, setStorageSync } = vi.hoisted(() => ({
  getStorageSync: vi.fn(),
  setStorageSync: vi.fn(),
}))

vi.mock('@tarojs/taro', () => ({
  default: { getStorageSync, setStorageSync },
}))

// 服务端的契约（pkuso-backend supabase/functions/_shared/diag.ts）：不合这个形状的头
// 会被当成「没带」丢掉——那样客户端照样记录，但再也对不上服务端那行日志，且**不会报错**。
// 所以这个正则在这里是硬约束，不是格式偏好。
const SERVER_CONTRACT = /^[A-Za-z0-9._-]{1,64}$/

async function loadModule() {
  vi.resetModules()
  return import('./diag')
}

describe('diag：请求关联 id 的客户端一半', () => {
  beforeEach(() => {
    getStorageSync.mockReset()
    setStorageSync.mockReset()
  })

  it('生成的 id 满足服务端契约（不满足就会被静默丢弃，且不会有任何报错）', async () => {
    getStorageSync.mockReturnValue('')
    const { newDiagId } = await loadModule()
    for (let i = 0; i < 20; i += 1) {
      const id = newDiagId()
      expect(id).toMatch(SERVER_CONTRACT)
      expect(id.length).toBeLessThanOrEqual(64)
    }
  })

  it('同一次运行内的 id 互不相同（撞了会把两次请求的日志错认成同一次）', async () => {
    getStorageSync.mockReturnValue('')
    const { newDiagId } = await loadModule()
    const ids = Array.from({ length: 50 }, () => newDiagId())
    expect(new Set(ids).size).toBe(50)
  })

  it('安装 id 持久化：首次落盘，之后复用同一个前缀', async () => {
    getStorageSync.mockReturnValue('')
    const { getInstallId } = await loadModule()
    const first = getInstallId()
    expect(setStorageSync).toHaveBeenCalledTimes(1)
    expect(setStorageSync.mock.calls[0][0]).toBe('pkuso_diag_install')

    // 下次启动（新模块实例）读到同一个值：同一台设备的失败记录因此能聚起来
    getStorageSync.mockReturnValue(first)
    const second = (await loadModule()).getInstallId()
    expect(second).toBe(first)
  })

  it('storage 里存的值不合契约时重新生成（坏值会让每次请求都被服务端丢掉）', async () => {
    getStorageSync.mockReturnValue('诊断-有中文')
    const { getInstallId } = await loadModule()
    expect(getInstallId()).toMatch(SERVER_CONTRACT)
    expect(setStorageSync).toHaveBeenCalled()
  })

  it('storage 抛错时不抛出，且仍给出可用的 id（上报契约：绝不影响业务）', async () => {
    getStorageSync.mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    setStorageSync.mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    const { newDiagId } = await loadModule()
    expect(() => newDiagId()).not.toThrow()
    expect(newDiagId()).toMatch(SERVER_CONTRACT)
  })
})
