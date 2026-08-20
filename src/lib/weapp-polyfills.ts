/**
 * 微信小程序运行时缺失的 Web API 全局 polyfill。
 *
 * supabase-js 的 fetch 包装层（fetchWithAuth）以裸标识符引用全局 Headers
 * （`const resolveHeadersConstructor = () => Headers`，无 typeof 守卫），
 * 小程序 JSCore 无此全局，模块初始化即抛
 * `ReferenceError: Headers is not defined`（app 启动即崩）。
 *
 * 本模块在 supabase-js 模块初始化前安装最小 Headers 实现——
 * 必须在 `src/lib/supabase.ts` 中作为首个 import（ESM/webpack 按声明顺序
 * 执行副作用 import，先于 @supabase/supabase-js 的模块求值）。
 *
 * 另补 URLSearchParams：storage-js 的 createSignedUrl/download 等路径
 * 无条件 `new URLSearchParams()`（无守卫），请假附件签名链接等功能依赖。
 * 未补的 Blob/File/FormData/AbortController：仅 storage 上传 File 路径与
 * postgrest timeout 选项使用，当前功能不触达，接入对应功能时再补。
 *
 * 仅在小程序端（TARO_ENV === 'weapp'，构建期常量折叠）且全局缺失时安装；
 * h5/测试环境（jsdom/Node 自带）不安装。
 */

/** 请求头存储：小写 key 归一化（HTTP 头大小写不敏感），迭代输出存储时的 key */
export class HeadersPolyfill {
  private map = new Map<string, string>()

  constructor(init?: unknown) {
    if (!init) return
    // 注意顺序：必须先判数组（数组自带 forEach，先判 forEach 会误入实例复制分支）
    if (Array.isArray(init)) {
      for (const pair of init) {
        if (Array.isArray(pair) && pair.length >= 2) {
          this.map.set(String(pair[0]).toLowerCase(), String(pair[1]))
        }
      }
      return
    }
    // 支持 HeadersPolyfill 实例与原生 Headers 实例（含 forEach 接口即可复制）
    if (typeof (init as { forEach?: unknown }).forEach === 'function') {
      ;(init as { forEach: (cb: (value: string, key: string) => void) => void }).forEach(
        (value, key) => this.map.set(key.toLowerCase(), String(value))
      )
      return
    }
    if (typeof init === 'object') {
      for (const [key, value] of Object.entries(init as Record<string, unknown>)) {
        if (value !== undefined && value !== null) {
          this.map.set(key.toLowerCase(), String(value))
        }
      }
    }
  }

  append(name: string, value: string): void {
    const key = name.toLowerCase()
    const existing = this.map.get(key)
    this.map.set(key, existing ? `${existing}, ${value}` : value)
  }

  delete(name: string): void {
    this.map.delete(name.toLowerCase())
  }

  get(name: string): string | null {
    return this.map.get(name.toLowerCase()) ?? null
  }

  has(name: string): boolean {
    return this.map.has(name.toLowerCase())
  }

  set(name: string, value: string): void {
    this.map.set(name.toLowerCase(), value)
  }

  forEach(callback: (value: string, key: string, parent: HeadersPolyfill) => void): void {
    this.map.forEach((value, key) => callback(value, key, this))
  }

  *entries(): IterableIterator<[string, string]> {
    yield* this.map.entries()
  }

  *keys(): IterableIterator<string> {
    yield* this.map.keys()
  }

  *values(): IterableIterator<string> {
    yield* this.map.values()
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries()
  }
}

/** 查询串：支持多值 key（append），toString 输出 encodeURIComponent 编码对 */
export class URLSearchParamsPolyfill {
  private map = new Map<string, string[]>()

  constructor(init?: unknown) {
    if (!init) return
    if (typeof init === 'string') {
      for (const pair of init.split('&')) {
        if (!pair) continue
        const [rawName, ...rest] = pair.split('=')
        this.append(
          decodeURIComponent(rawName.replace(/\+/g, ' ')),
          decodeURIComponent(rest.join('=').replace(/\+/g, ' '))
        )
      }
      return
    }
    if (Array.isArray(init)) {
      for (const pair of init) {
        if (Array.isArray(pair) && pair.length >= 2) {
          this.append(String(pair[0]), String(pair[1]))
        }
      }
      return
    }
    if (typeof (init as { forEach?: unknown }).forEach === 'function') {
      // URLSearchParamsPolyfill 实例复制
      ;(init as { forEach: (cb: (value: string, key: string) => void) => void }).forEach(
        (value, key) => this.append(key, value)
      )
      return
    }
    if (typeof init === 'object') {
      for (const [key, value] of Object.entries(init as Record<string, unknown>)) {
        this.append(key, String(value))
      }
    }
  }

  append(name: string, value: string): void {
    const values = this.map.get(name) ?? []
    values.push(value)
    this.map.set(name, values)
  }

  delete(name: string): void {
    this.map.delete(name)
  }

  get(name: string): string | null {
    return this.map.get(name)?.[0] ?? null
  }

  getAll(name: string): string[] {
    return this.map.get(name) ?? []
  }

  has(name: string): boolean {
    return this.map.has(name)
  }

  set(name: string, value: string): void {
    this.map.set(name, [value])
  }

  toString(): string {
    const pairs: string[] = []
    this.map.forEach((values, name) => {
      for (const value of values) {
        pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
      }
    })
    return pairs.join('&')
  }

  forEach(callback: (value: string, key: string) => void): void {
    this.map.forEach((values, name) => {
      for (const value of values) callback(value, name)
    })
  }

  *entries(): IterableIterator<[string, string]> {
    for (const [name, values] of this.map.entries()) {
      for (const value of values) yield [name, value]
    }
  }

  *keys(): IterableIterator<string> {
    for (const [name, values] of this.map.entries()) {
      for (let i = 0; i < values.length; i += 1) yield name
    }
  }

  *values(): IterableIterator<string> {
    for (const values of this.map.values()) {
      for (const value of values) yield value
    }
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries()
  }
}

const hasNativeHeaders = typeof Headers !== 'undefined'
const hasNativeURLSearchParams = typeof URLSearchParams !== 'undefined'

/**
 * 给「仅支持 http/https 的 URL 实现」打 ws 协议补丁。
 *
 * 背景：Taro 运行时注入的 URL 实现（TaroURL）构造器只接受 http/https 绝对 URL
 * （`VALID_URL = /^(https?:)\/\//`），而 supabase-js 会把 realtime 端点协议置为
 * wss（`realtimeUrl.protocol = protocol.replace("http", "ws")`），realtime-js 再
 * 对它 `new URL(wss://...)`——启动即抛 `Failed to construct 'URL': Invalid URL`。
 * 小程序端不建立 realtime 连接，只需 URL 构造与 href 读取不抛错：
 * 拦截 protocol setter，把 ws:/wss: 降级为 http:/https: 存储（href 随之保持 http(s)）。
 *
 * 自守卫：探测 `new URL('wss://…')` 成功（Node/浏览器原生实现）时不打补丁。
 */
export function patchUrlProtocolSetterForWs(UrlClass: unknown): void {
  const proto = (UrlClass as { prototype?: Record<string, unknown> }).prototype
  if (!proto) return
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'protocol') as
    PropertyDescriptor | undefined
  if (!descriptor || typeof descriptor.set !== 'function' || typeof descriptor.get !== 'function') {
    return
  }
  const originalSet = descriptor.set as (value: string) => void
  Object.defineProperty(proto, 'protocol', {
    get: descriptor.get,
    set(value: string) {
      const p = String(value).trim().toLowerCase()
      if (p === 'wss:' || p === 'ws:') {
        originalSet.call(this, p === 'wss:' ? 'https:' : 'http:')
        return
      }
      originalSet.call(this, value)
    },
    enumerable: descriptor.enumerable,
    configurable: descriptor.configurable,
  })
}

/** 探测当前 URL 实现是否支持 ws/wss 构造；不支持时打 protocol setter 补丁 */
function ensureUrlSupportsWs(): void {
  try {
    void new URL('wss://probe.invalid')
    return // 构造成功：原生实现（Node/浏览器），无需补丁
  } catch {
    // 不支持 wss：继续打补丁
  }
  try {
    const probe = new URL('https://probe.invalid')
    patchUrlProtocolSetterForWs(probe.constructor)
  } catch {
    // URL 全局缺失且无法构造：留待调用方报错
  }
}

if (process.env.TARO_ENV === 'weapp') {
  const g = globalThis as unknown as Record<string, unknown>
  // 显式挂到 globalThis：supabase-js 以裸标识符解析 Headers，走作用域链到全局
  if (!hasNativeHeaders) g.Headers = HeadersPolyfill
  if (!hasNativeURLSearchParams) g.URLSearchParams = URLSearchParamsPolyfill
  ensureUrlSupportsWs()
}
