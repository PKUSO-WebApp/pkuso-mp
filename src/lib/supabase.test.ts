import { afterEach, describe, expect, it, vi } from 'vitest'

const { webCreate, request, getStorage, setStorage, removeStorage, getStorageSync, setStorageSync } =
  vi.hoisted(() => ({
    webCreate: vi.fn(),
    request: vi.fn(),
    getStorage: vi.fn(),
    setStorage: vi.fn(),
    removeStorage: vi.fn(),
    // lib/diag 用它持久化安装 id
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
  }))

vi.mock('@tarojs/taro', () => ({
  default: { request, getStorage, setStorage, removeStorage, getStorageSync, setStorageSync },
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
        // 小程序无全局 WebSocket：注入占位 transport 跳过 realtime-js 的运行时检测
        realtime: expect.objectContaining({ transport: expect.any(Function) }),
      })
    )
  })

  it('H5 端仍使用官方 fetch，且不注入占位 transport（走原生 WebSocket）', async () => {
    vi.stubEnv('TARO_ENV', 'h5')
    vi.stubEnv('TARO_APP_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('TARO_APP_SUPABASE_ANON_KEY', 'anon-key')
    vi.doMock('@supabase/supabase-js', () => ({ createClient: webCreate }))
    await import('@/lib/supabase')
    expect(webCreate.mock.calls[0][2].global.fetch).toBe(fetch)
    expect(webCreate.mock.calls[0][2].realtime).toBeUndefined()
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

  it('请求失败统一上报：网络层与 5xx 记 error、4xx 记 warn，且上报端点自身不上报', async () => {
    vi.stubEnv('TARO_ENV', 'weapp')
    vi.stubEnv('TARO_APP_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('TARO_APP_SUPABASE_ANON_KEY', 'anon-key')
    vi.doMock('@supabase/supabase-js', () => ({ createClient: webCreate }))

    const { taroFetch, setRequestFailureReporter } = await import('@/lib/supabase')
    const reported: { event: string; level: string; message: string }[] = []
    setRequestFailureReporter((input) => {
      reported.push(input as { event: string; level: string; message: string })
    })

    // 网络层失败（断网 / DNS 解析不了）→ error
    request.mockRejectedValueOnce(new Error('net::ERR_NAME_NOT_RESOLVED'))
    await expect(
      taroFetch('https://project.supabase.co/rest/v1/notifications?select=*')
    ).rejects.toThrow('ERR_NAME_NOT_RESOLVED')
    expect(reported[0]).toMatchObject({ event: 'request_failed', level: 'error' })
    // 路径进 message：指纹按 event+message 算，于是不同端点各算一条、同一端点仍被去重
    expect(reported[0].message).toContain('/rest/v1/notifications')
    expect(reported[0].message).not.toContain('?') // 去掉 query，避免同端点不同参数各算一条

    // 5xx → error
    request.mockResolvedValueOnce({ statusCode: 503, header: {}, data: 'oops' })
    await taroFetch('https://project.supabase.co/rest/v1/posts')
    expect(reported[1]).toMatchObject({ level: 'error' })
    expect(reported[1].message).toContain('503')

    // 4xx → warn（鉴权/参数问题不该和断网同级）
    request.mockResolvedValueOnce({ statusCode: 401, header: {}, data: '{}' })
    await taroFetch('https://project.supabase.co/rest/v1/profiles')
    expect(reported[2]).toMatchObject({ level: 'warn' })

    // 上报端点自身失败绝不再上报——否则断网时形成 上报→失败→上报 的循环
    request.mockRejectedValueOnce(new Error('still down'))
    await expect(
      taroFetch('https://project.supabase.co/rest/v1/client_error_logs')
    ).rejects.toThrow('still down')
    expect(reported).toHaveLength(3)
  })

  it('请求成功后触发 success hook（供补送队列），但上报端点自身不触发', async () => {
    vi.stubEnv('TARO_ENV', 'weapp')
    vi.stubEnv('TARO_APP_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('TARO_APP_SUPABASE_ANON_KEY', 'anon-key')
    vi.doMock('@supabase/supabase-js', () => ({ createClient: webCreate }))

    const { taroFetch, setRequestSuccessHook } = await import('@/lib/supabase')
    let hits = 0
    setRequestSuccessHook(() => {
      hits += 1
    })

    request.mockResolvedValueOnce({ statusCode: 200, header: {}, data: '{}' })
    await taroFetch('https://project.supabase.co/rest/v1/posts')
    expect(hits).toBe(1)

    // 拿到响应就说明链路可达，4xx 也算「网通了」
    request.mockResolvedValueOnce({ statusCode: 401, header: {}, data: '{}' })
    await taroFetch('https://project.supabase.co/rest/v1/profiles')
    expect(hits).toBe(2)

    // 上报端点自身绝不触发：否则 flush 成功会再触发一次 flush（递归）
    request.mockResolvedValueOnce({ statusCode: 201, header: {}, data: '{}' })
    await taroFetch('https://project.supabase.co/rest/v1/client_error_logs')
    expect(hits).toBe(2)
  })

  it('未注入 reporter 时请求失败保持静默（不影响请求本身）', async () => {
    vi.stubEnv('TARO_ENV', 'weapp')
    vi.stubEnv('TARO_APP_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('TARO_APP_SUPABASE_ANON_KEY', 'anon-key')
    vi.doMock('@supabase/supabase-js', () => ({ createClient: webCreate }))
    request.mockRejectedValueOnce(new Error('网络失败'))

    const { taroFetch } = await import('@/lib/supabase')
    // 没有 reporter 也不能改变请求语义：照常 reject
    await expect(taroFetch('https://project.supabase.co/rest/v1/test')).rejects.toThrow('网络失败')
  })

  it('每次请求都带关联 id；调用方自带的优先（登录链路要拿同一个值去写失败记录）', async () => {
    vi.stubEnv('TARO_ENV', 'weapp')
    vi.stubEnv('TARO_APP_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('TARO_APP_SUPABASE_ANON_KEY', 'anon-key')
    vi.doMock('@supabase/supabase-js', () => ({ createClient: webCreate }))
    request.mockResolvedValue({ statusCode: 200, header: {}, data: '{}' })

    const { taroFetch } = await import('@/lib/supabase')
    const diagOf = (call: number) => request.mock.calls[call][0].header['x-pkuso-diag'] as string

    // 没带 → 自动生成，且必须满足服务端契约（不满足会被服务端静默丢弃、且不报错）
    await taroFetch('https://project.supabase.co/rest/v1/test')
    expect(diagOf(0)).toMatch(/^[A-Za-z0-9._-]{1,64}$/)
    await taroFetch('https://project.supabase.co/rest/v1/test')
    expect(diagOf(1)).not.toBe(diagOf(0))

    // 调用方带了 → 用它的（登录链路靠这个把「请求头里的 id」和「失败记录里的 id」对齐）
    await taroFetch('https://project.supabase.co/rest/v1/test', {
      headers: { 'x-pkuso-diag': 'caller-owned' },
    })
    expect(diagOf(2)).toBe('caller-owned')

    // 大小写不敏感：换了大小写也算「已带」，不重复注入
    await taroFetch('https://project.supabase.co/rest/v1/test', {
      headers: { 'X-Pkuso-Diag': 'caller-cased' },
    })
    expect(request.mock.calls[3][0].header['X-Pkuso-Diag']).toBe('caller-cased')
    expect(request.mock.calls[3][0].header['x-pkuso-diag']).toBeUndefined()
  })

  it('失败记录带上 diag / ms / errRaw / 状态码：分别回答「对得上吗」「卡了多久」「到底报了什么」', async () => {
    vi.stubEnv('TARO_ENV', 'weapp')
    vi.stubEnv('TARO_APP_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('TARO_APP_SUPABASE_ANON_KEY', 'anon-key')
    vi.doMock('@supabase/supabase-js', () => ({ createClient: webCreate }))

    const { taroFetch, setRequestFailureReporter } = await import('@/lib/supabase')
    const reported: { detail: Record<string, unknown> }[] = []
    setRequestFailureReporter((input) => {
      reported.push(input as { detail: Record<string, unknown> })
    })

    // 网络层失败：微信只给一句光秃秃的 `request:fail`，原因往往挂在同一个对象的别的字段上
    request.mockRejectedValueOnce({ errMsg: 'request:fail', errCode: -1 })
    await expect(
      taroFetch('https://project.supabase.co/rest/v1/posts')
    ).rejects.toMatchObject({ errMsg: 'request:fail' })

    expect(reported[0].detail.diag).toMatch(/^[A-Za-z0-9._-]{1,64}$/)
    expect(reported[0].detail.ms).toBeGreaterThanOrEqual(0)
    // 整个对象都留下，不只 errMsg——否则又要靠猜
    expect(reported[0].detail.errRaw).toContain('request:fail')
    expect(reported[0].detail.errRaw).toContain('errCode')

    // HTTP 失败：状态码既进 message（指纹粒度）也进字段（可聚合）；
    // diag 与请求头里带的是同一个值——服务端日志就是靠它对上的
    request.mockResolvedValueOnce({ statusCode: 502, header: {}, data: 'bad gateway' })
    await taroFetch('https://project.supabase.co/functions/v1/wechat-auth')
    expect(reported[1].detail.status).toBe(502)
    expect(reported[1].detail.diag).toBe(
      request.mock.calls[1][0].header['x-pkuso-diag'] as string
    )
  })

  it('taroFetch 兜底注入 apikey，已有 apikey 不重复注入', async () => {
    vi.stubEnv('TARO_ENV', 'weapp')
    vi.stubEnv('TARO_APP_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('TARO_APP_SUPABASE_ANON_KEY', 'anon-key')
    vi.doMock('@supabase/supabase-js', () => ({ createClient: webCreate }))
    request.mockResolvedValue({ statusCode: 200, header: {}, data: '{}' })

    const { taroFetch } = await import('@/lib/supabase')
    // 无 apikey：兜底注入配置的 anon key（PostgREST 否则报 No API key found）
    await taroFetch('https://project.supabase.co/rest/v1/test')
    expect(request.mock.calls[0][0].header.apikey).toBe('anon-key')
    // 已有 apikey：保留原值
    await taroFetch('https://project.supabase.co/rest/v1/test', { headers: { apikey: 'existing' } })
    expect(request.mock.calls[1][0].header.apikey).toBe('existing')
    // 头名大小写不敏感识别：Apikey 视为已存在，不重复注入
    await taroFetch('https://project.supabase.co/rest/v1/test', {
      headers: { Apikey: 'case-insensitive' },
    })
    expect(request.mock.calls[2][0].header.Apikey).toBe('case-insensitive')
    expect(request.mock.calls[2][0].header.apikey).toBeUndefined()
  })
})
