import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getStorageSync, setStorageSync } = vi.hoisted(() => ({
  getStorageSync: vi.fn(() => ''),
  setStorageSync: vi.fn(),
}))

vi.mock('@tarojs/taro', () => ({ default: { getStorageSync, setStorageSync } }))

const DIRECT = 'https://direct.supabase.co'
const PROXY = 'https://proxy.example.com'

/** 每个用例都重新求值模块：基址与 hasProxy 是模块级常量，改 env 后必须重新 import */
async function loadEntry(env: { url?: string; proxy?: string } = {}) {
  vi.stubEnv('TARO_APP_SUPABASE_URL', env.url ?? DIRECT)
  vi.stubEnv('TARO_APP_SUPABASE_PROXY_URL', env.proxy ?? '')
  vi.resetModules()
  return import('@/lib/supabase-entry')
}

describe('后端入口的选择与切换', () => {
  beforeEach(() => {
    getStorageSync.mockReturnValue('')
    setStorageSync.mockReset()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('没配反代 ⇒ 单入口：基址就是直连，且没有「另一个入口」可换', async () => {
    const m = await loadEntry()
    expect(m.hasProxy).toBe(false)
    expect(m.directBase).toBe(DIRECT)
    expect(m.activeEntry()).toBe('direct')
    // 空字符串与未定义一样当作「没配」——CI 里 secret 没设时写出来的就是空值
    expect(m.otherEntry('direct')).toBeNull()
    expect(m.switchTo('proxy')).toBeNull()
  })

  it('配了反代 ⇒ 主入口是反代、备入口是直连，但**基址仍是直连**', async () => {
    const m = await loadEntry({ proxy: PROXY })
    expect(m.hasProxy).toBe(true)
    // 基址不是反代：storage 的 publicUrl / createSignedUrl 由它派生，而那些 URL 绕过
    // taroFetch，改写成反代会让大文件从后门走回云函数
    expect(m.directBase).toBe(DIRECT)
    expect(m.activeEntry()).toBe('proxy')
    expect(m.otherEntry('proxy')).toBe('direct')
    expect(m.otherEntry('direct')).toBe('proxy')
    expect(m.baseFor('direct')).toBe(DIRECT)
    expect(m.baseFor('proxy')).toBe(PROXY)
  })

  it('重写只换基址，路径与 query 原样；不是本项目的 URL 一律不碰', async () => {
    const m = await loadEntry({ proxy: PROXY })
    expect(m.rewriteToActive(`${DIRECT}/rest/v1/rehearsals?select=id`)).toBe(
      `${PROXY}/rest/v1/rehearsals?select=id`
    )
    expect(m.rewriteTo(`${DIRECT}/auth/v1/token?grant_type=refresh_token`, 'direct')).toBe(
      `${DIRECT}/auth/v1/token?grant_type=refresh_token`
    )
    // 第三方域名（别的 CDN、别人家的 supabase）绝不能被引到自家反代上
    expect(m.rewriteTo('https://cdn.example.com/a.pdf', 'proxy')).toBe(
      'https://cdn.example.com/a.pdf'
    )
    // 前缀相同、域名不同的地址也不是自家的：只按 startsWith 改写会把它引到反代上
    expect(m.rewriteTo('https://direct.supabase.co.evil.com/x', 'proxy')).toBe(
      'https://direct.supabase.co.evil.com/x'
    )
    // ⚠️ 注意：本函数**不知道 storage 要豁免**，它对 storage 路径一视同仁地换入口。
    // 那条规则在 taroFetch 那一层（它对 `/storage/v1/` 压根不调重写）——所以别在别处
    // 直接拿这个函数去处理 storage 的 URL
    expect(m.rewriteTo(`${DIRECT}/storage/v1/object/public/scores/a.pdf`, 'proxy')).toBe(
      `${PROXY}/storage/v1/object/public/scores/a.pdf`
    )
  })

  it('尾斜杠会被归一化——否则重写出来的 URL 会多一条斜杠', async () => {
    const m = await loadEntry({ proxy: `${PROXY}/` })
    expect(m.directBase).toBe(DIRECT)
    expect(m.baseFor('proxy')).toBe(PROXY)
  })

  it('上次的选择从本地存储恢复；认不出的值退回家门口的反代', async () => {
    getStorageSync.mockReturnValue('direct')
    expect((await loadEntry({ proxy: PROXY })).activeEntry()).toBe('direct')

    getStorageSync.mockReturnValue('垃圾值')
    expect((await loadEntry({ proxy: PROXY })).activeEntry()).toBe('proxy')

    // 没配反代时，存着 'proxy' 也不能生效——那是上一个版本留下的残留
    getStorageSync.mockReturnValue('proxy')
    expect((await loadEntry()).activeEntry()).toBe('direct')
  })

  it('切换会持久化，返回切换记录；切到同一个入口不算切换', async () => {
    const m = await loadEntry({ proxy: PROXY })
    expect(m.switchTo('direct')).toEqual({ from: 'proxy', to: 'direct' })
    expect(m.activeEntry()).toBe('direct')
    expect(setStorageSync).toHaveBeenCalledWith('pkuso_supabase_entry', 'direct')

    setStorageSync.mockReset()
    expect(m.switchTo('direct')).toBeNull()
    expect(setStorageSync).not.toHaveBeenCalled()
  })

  it('持久化失败不能反过来影响本次会话', async () => {
    setStorageSync.mockImplementation(() => {
      throw new Error('storage full')
    })
    const m = await loadEntry({ proxy: PROXY })
    expect(() => m.switchTo('direct')).not.toThrow()
    expect(m.activeEntry()).toBe('direct')
  })

  it('存储读不出来（从未写过 / 被清）不是错误，用默认值', async () => {
    getStorageSync.mockImplementation(() => {
      throw new Error('boom')
    })
    expect((await loadEntry({ proxy: PROXY })).activeEntry()).toBe('proxy')
  })
})
