import { afterEach, describe, expect, it, vi } from 'vitest'

const { webCreate, request, getStorage, setStorage, removeStorage } = vi.hoisted(() => ({
  webCreate: vi.fn(),
  request: vi.fn(),
  getStorage: vi.fn(),
  setStorage: vi.fn(),
  removeStorage: vi.fn(),
}))

vi.mock('@tarojs/taro', () => ({
  default: { request, getStorage, setStorage, removeStorage },
}))

describe('supabase 官方客户端适配', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
    webCreate.mockReset()
    request.mockReset()
  })

  it('微信端使用 Taro fetch 与异步 Storage adapter', async () => {
    vi.stubEnv('TARO_ENV', 'weapp')
    vi.stubEnv('TARO_APP_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('TARO_APP_SUPABASE_ANON_KEY', 'anon-key')
    vi.doMock('@supabase/supabase-js', () => ({ createClient: webCreate }))
    await import('@/lib/supabase')
    expect(webCreate).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'anon-key',
      expect.objectContaining({
        auth: expect.objectContaining({ detectSessionInUrl: false, storage: expect.any(Object) }),
        global: expect.objectContaining({ fetch: expect.any(Function) }),
      })
    )
  })

  it('H5 端仍使用官方 fetch', async () => {
    vi.stubEnv('TARO_ENV', 'h5')
    vi.stubEnv('TARO_APP_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('TARO_APP_SUPABASE_ANON_KEY', 'anon-key')
    vi.doMock('@supabase/supabase-js', () => ({ createClient: webCreate }))
    await import('@/lib/supabase')
    expect(webCreate.mock.calls[0][2].global.fetch).toBe(fetch)
  })

  it('Taro response 与多种请求体可转换，错误会透传', async () => {
    vi.stubEnv('TARO_ENV', 'weapp')
    vi.stubEnv('TARO_APP_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('TARO_APP_SUPABASE_ANON_KEY', 'anon-key')
    vi.doMock('@supabase/supabase-js', () => ({ createClient: webCreate }))
    request.mockResolvedValue({
      statusCode: 201,
      header: { 'content-type': 'application/json' },
      data: '{"ok":true}',
    })

    const { taroFetch } = await import('@/lib/supabase')
    const arrayBuffer = new ArrayBuffer(2)
    await taroFetch('https://project.supabase.co/rest/v1/test', {
      method: 'POST',
      body: JSON.stringify({ ok: true }),
    })
    expect(request.mock.calls[0][0].data).toBe('{"ok":true}')
    await taroFetch('https://project.supabase.co/storage/v1/object/test', {
      method: 'POST',
      body: arrayBuffer,
    })
    expect(request.mock.calls[1][0].data).toBe(arrayBuffer)
    const blob = new Blob(['file'])
    await taroFetch('https://project.supabase.co/storage/v1/object/test', {
      method: 'POST',
      body: blob,
    })
    expect(request.mock.calls[2][0].data).toBeInstanceOf(ArrayBuffer)

    const utf8Json = new Uint8Array([
      0x7b, 0x22, 0x6f, 0x6b, 0x22, 0x3a, 0x74, 0x72, 0x75, 0x65, 0x7d,
    ]).buffer
    vi.stubGlobal('Response', undefined)
    vi.stubGlobal('Blob', undefined)
    vi.stubGlobal('TextEncoder', undefined)
    vi.stubGlobal('TextDecoder', undefined)
    vi.stubGlobal('FormData', undefined)
    request.mockResolvedValue({
      statusCode: 200,
      header: { 'content-type': 'application/json' },
      data: utf8Json,
    })
    const binaryResponse = await taroFetch('https://project.supabase.co/rest/v1/test', {
      method: 'POST',
      body: JSON.stringify({ ok: true }),
    })
    expect(request.mock.calls[3][0].data).toBe('{"ok":true}')
    expect(await binaryResponse.text()).toBe('{"ok":true}')
    expect(await binaryResponse.json()).toEqual({ ok: true })
    expect(await binaryResponse.arrayBuffer()).toBe(utf8Json)

    const arrayResponse = await taroFetch('https://project.supabase.co/rest/v1/test', {
      method: 'POST',
      body: utf8Json,
    })
    expect(request.mock.calls[4][0].data).toBe(utf8Json)
    expect(await arrayResponse.text()).toBe('{"ok":true}')

    request.mockResolvedValueOnce({ statusCode: 200, header: {}, data: 'plain text' })
    const textResponse = await taroFetch('https://project.supabase.co/rest/v1/test')
    expect(await textResponse.text()).toBe('plain text')
    await expect(textResponse.blob()).rejects.toThrow('不支持 Blob')
    await expect(textResponse.formData()).rejects.toThrow('不支持 FormData')

    request.mockResolvedValueOnce({
      statusCode: 200,
      header: { 'Content-Type': 'application/json' },
      data: { ok: true },
    })
    const objectResponse = await taroFetch('https://project.supabase.co/rest/v1/test')
    expect(await objectResponse.text()).toBe('{"ok":true}')
    expect(await objectResponse.json()).toEqual({ ok: true })
    expect(objectResponse.headers.get('content-type')).toBe('application/json')
    expect(objectResponse.headers.get('CONTENT-TYPE')).toBe('application/json')
    expect(objectResponse.headers.has('content-type')).toBe(true)

    request.mockRejectedValueOnce(new Error('网络失败'))
    await expect(taroFetch('https://project.supabase.co/rest/v1/test')).rejects.toThrow('网络失败')
  })

  it('配置缺失时直接抛错', async () => {
    vi.stubEnv('TARO_APP_SUPABASE_URL', '')
    vi.stubEnv('TARO_APP_SUPABASE_ANON_KEY', '')
    await expect(import('@/lib/supabase')).rejects.toThrow('缺少 Supabase 配置')
  })
})
