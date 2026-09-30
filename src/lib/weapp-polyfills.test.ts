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

  it('patchUrlProtocolSetterForWs 把 ws/wss 协议降级为 http/https 存储', async () => {
    const { patchUrlProtocolSetterForWs } = await import('@/lib/weapp-polyfills')
    // 仿 TaroURL：构造器仅接受 http/https，protocol 为 accessor
    class FakeTaroURL {
      private protocolValue = ''
      constructor(url: string, base?: string) {
        const VALID = /^(https?:)\/\//i
        if (base === undefined && !VALID.test(url)) {
          throw new TypeError("Failed to construct 'URL': Invalid URL")
        }
        // ⚠️ 这里原来写的是
        //   `/^(https?:|wss?:)/i.exec(url)?.[1].toLowerCase() + ':' ?? ''`
        // `+ ':'` 让左边永远不是 nullish ⇒ `?? ''` 是死代码，而匹配不上时会得到
        // 字符串 `"undefined:"`（TS 5.9 的 TS2869 把这条抓了出来）。
        // 构造器只对「无 base 且不是 http(s)」抛错，所以匹配不上那条路只在带 base 时到得了。
        const scheme = /^(https?:|wss?:)/i.exec(url)
        this.protocolValue = scheme ? scheme[1].toLowerCase() + ':' : ''
      }
      get protocol() {
        return this.protocolValue
      }
      set protocol(v: string) {
        this.protocolValue = v
      }
      get href() {
        return `${this.protocolValue}//host/`
      }
    }
    patchUrlProtocolSetterForWs(FakeTaroURL)
    const u = new FakeTaroURL('https://x.co/realtime/v1')
    u.protocol = 'wss:'
    expect(u.protocol).toBe('https:')
    expect(u.href).toBe('https://host/')
    u.protocol = 'ws:'
    expect(u.protocol).toBe('http:')
    u.protocol = 'https:'
    expect(u.protocol).toBe('https:')
  })

  it('patchUrlProtocolSetterForWs 对无 protocol accessor 的类为无操作', async () => {
    const { patchUrlProtocolSetterForWs } = await import('@/lib/weapp-polyfills')
    class PlainClass {
      field = ''
    }
    // 不抛错即为通过
    patchUrlProtocolSetterForWs(PlainClass)
  })
})
