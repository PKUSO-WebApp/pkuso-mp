import { afterEach, describe, expect, it, vi } from 'vitest'

describe('weapp-polyfills', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('HeadersPolyfill 构造/读写/大小写不敏感/append/delete', async () => {
    const { HeadersPolyfill } = await import('@/lib/weapp-polyfills')
    const h = new HeadersPolyfill({ Apikey: 'k', 'X-Client': 'a' })
    expect(h.get('apikey')).toBe('k')
    expect(h.has('x-client')).toBe(true)
    h.set('Prefer', 'return=minimal')
    expect(h.get('prefer')).toBe('return=minimal')
    h.append('prefer', 'count=exact')
    expect(h.get('prefer')).toBe('return=minimal, count=exact')
    h.delete('apikey')
    expect(h.has('apikey')).toBe(false)
    expect(h.get('missing')).toBeNull()
  })

  it('HeadersPolyfill 从实例/数组构造与迭代', async () => {
    const { HeadersPolyfill } = await import('@/lib/weapp-polyfills')
    const base = new HeadersPolyfill([
      ['a', '1'],
      ['b', '2'],
    ])
    const copy = new HeadersPolyfill(base)
    expect(copy.get('a')).toBe('1')
    const collected: string[] = []
    copy.forEach((value, key) => collected.push(`${key}=${value}`))
    expect(collected.sort()).toEqual(['a=1', 'b=2'])
    expect([...copy]).toEqual([
      ['a', '1'],
      ['b', '2'],
    ])
  })

  it('URLSearchParamsPolyfill set/append/toString 编码', async () => {
    const { URLSearchParamsPolyfill } = await import('@/lib/weapp-polyfills')
    const q = new URLSearchParamsPolyfill()
    q.set('download', 'true')
    q.append('transform', 'w=100')
    expect(q.get('download')).toBe('true')
    expect(q.toString()).toBe('download=true&transform=w%3D100')
    q.delete('download')
    expect(q.has('download')).toBe(false)
    expect([...q]).toEqual([['transform', 'w=100']])
  })

  it('weapp 且全局缺失时安装 Headers 与 URLSearchParams', async () => {
    vi.stubEnv('TARO_ENV', 'weapp')
    vi.stubGlobal('Headers', undefined)
    vi.stubGlobal('URLSearchParams', undefined)
    await import('@/lib/weapp-polyfills')
    const g = globalThis as unknown as Record<string, unknown>
    expect(typeof g.Headers).toBe('function')
    expect(typeof g.URLSearchParams).toBe('function')
  })

  it('h5 环境不安装 polyfill', async () => {
    vi.stubEnv('TARO_ENV', 'h5')
    vi.stubGlobal('Headers', undefined)
    await import('@/lib/weapp-polyfills')
    const g = globalThis as unknown as Record<string, unknown>
    expect(g.Headers).toBeUndefined()
  })
})
