import { afterEach, describe, expect, it, vi } from 'vitest'

const { weappCreate, webCreate } = vi.hoisted(() => ({
  weappCreate: vi.fn(),
  webCreate: vi.fn(),
}))

// 双端分叉验证：不静态 import 真实模块（顶层 env 校验会抛错且模块只加载一次），
// 用 vi.resetModules + vi.doMock + 动态 import 分别验证两端分支
describe('supabase 双端分叉', () => {
  const url = 'https://project.supabase.co'
  const key = 'anon-key'

  const loadSupabase = async () => {
    vi.resetModules()
    vi.stubEnv('TARO_APP_SUPABASE_URL', url)
    vi.stubEnv('TARO_APP_SUPABASE_ANON_KEY', key)
    vi.doMock('supabase-wechat-stable-v2', () => ({ createClient: weappCreate }))
    vi.doMock('@supabase/supabase-js', () => ({ createClient: webCreate }))
    return import('@/lib/supabase')
  }

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    weappCreate.mockClear()
    webCreate.mockClear()
  })

  it('TARO_ENV=weapp 使用 wechat client', async () => {
    vi.stubEnv('TARO_ENV', 'weapp')
    await loadSupabase()
    expect(weappCreate).toHaveBeenCalledWith(url, key, { auth: { detectSessionInUrl: false } })
    expect(webCreate).not.toHaveBeenCalled()
  })

  it('TARO_ENV=h5 使用官方 client', async () => {
    vi.stubEnv('TARO_ENV', 'h5')
    await loadSupabase()
    expect(webCreate).toHaveBeenCalledWith(url, key, { auth: { detectSessionInUrl: false } })
    expect(weappCreate).not.toHaveBeenCalled()
  })

  it('配置缺失时直接抛错（双端共享校验）', async () => {
    vi.resetModules()
    vi.stubEnv('TARO_APP_SUPABASE_URL', '')
    vi.stubEnv('TARO_APP_SUPABASE_ANON_KEY', '')
    await expect(import('@/lib/supabase')).rejects.toThrow('缺少 Supabase 配置')
  })
})
