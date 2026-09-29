import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { taroRequestMock, reportClientErrorMock, getStorageSyncMock, setStorageSyncMock } =
  vi.hoisted(() => ({
    taroRequestMock: vi.fn(),
    reportClientErrorMock: vi.fn(),
    getStorageSyncMock: vi.fn(() => ''),
    setStorageSyncMock: vi.fn(),
  }))

vi.mock('@tarojs/taro', () => ({
  default: {
    request: taroRequestMock,
    getStorageSync: getStorageSyncMock,
    setStorageSync: setStorageSyncMock,
  },
}))
// error-report 会连带 import supabase（缺环境变量时模块加载即抛），这里只替掉它的上报口
vi.mock('@/lib/error-report', () => ({ reportClientError: reportClientErrorMock }))
vi.mock('@/lib/session-diag', () => ({ logDiag: vi.fn() }))

const DIRECT = 'https://x.supabase.co'
const PROXY = 'https://proxy.example.com'

/** 真实响应体的形状：纯文本 key=value 行 */
const TRACE = [
  'fl=123abc',
  'h=xxxx.supabase.co',
  'ip=1.2.3.4',
  'ts=1759100000.123',
  'visit_scheme=https',
  'colo=HKG',
  'loc=HK',
  'tls=TLSv1.3',
  '',
].join('\n')

/**
 * 造一个「像 RequestTask 一样」的返回值：它既是 Promise，又带 onHeadersReceived。
 *
 * 真机上首字节明显早于 body 收完，所以这里让 ttfb 与 total 分开 —— 只测「总耗时」的实现在
 * 这个夹具下会拿到两个相等的数，一眼能看出来。
 */
function makeTask(
  result: unknown,
  opts: { ttfbMs: number; totalMs: number }
): Promise<unknown> & { onHeadersReceived: (cb: () => void) => void } {
  let onHeaders: (() => void) | undefined
  const promise = new Promise((resolve) => {
    setTimeout(() => resolve(result), opts.totalMs)
  }) as Promise<unknown> & { onHeadersReceived?: (cb: () => void) => void }
  promise.onHeadersReceived = (cb: () => void) => {
    onHeaders = cb
  }
  setTimeout(() => onHeaders?.(), opts.ttfbMs)
  return promise as Promise<unknown> & { onHeadersReceived: (cb: () => void) => void }
}

/** 每个用例都重新求值模块：入口基址是模块级常量，改 env 后必须重新 import */
async function loadProbe(env: { url?: string; proxy?: string } = {}) {
  vi.stubEnv('TARO_APP_SUPABASE_URL', env.url ?? DIRECT)
  vi.stubEnv('TARO_APP_SUPABASE_PROXY_URL', env.proxy ?? '')
  vi.resetModules()
  const entry = await import('@/lib/supabase-entry')
  entry.__resetEntryForTest()
  const probe = await import('@/lib/colo-probe')
  probe.__resetColoProbeForTest()
  return probe
}

const reportsOf = (event: string) =>
  reportClientErrorMock.mock.calls.map((c) => c[0]).filter((r) => r.event === event)

describe('Cloudflare PoP 探针', () => {
  beforeEach(() => {
    taroRequestMock.mockReset()
    reportClientErrorMock.mockReset()
    setStorageSyncMock.mockReset()
    getStorageSyncMock.mockReturnValue('')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('解析 colo / loc；畸形行不抛', async () => {
    const { parseColoTrace } = await loadProbe()
    expect(parseColoTrace(TRACE)).toEqual({ colo: 'HKG', loc: 'HK' })
    // 空响应、空行、没有 '=' 的行、值为空 —— 一律退化成 null，由调用方丢弃
    expect(parseColoTrace('')).toEqual({ colo: null, loc: null })
    expect(parseColoTrace('garbage\n=novalue\ncolo=\nloc')).toEqual({ colo: null, loc: null })
  })

  it('成功时把落点上报到服务端——边缘应答不落 origin，这是库端唯一的落点证据', async () => {
    taroRequestMock.mockResolvedValue({ statusCode: 200, data: TRACE })
    const { probeColo } = await loadProbe()

    await probeColo('launch')

    expect(taroRequestMock).toHaveBeenCalledTimes(1)
    expect(taroRequestMock.mock.calls[0][0]).toMatchObject({ url: `${DIRECT}/cdn-cgi/trace` })
    expect(reportClientErrorMock).toHaveBeenCalledTimes(1)
    expect(reportClientErrorMock.mock.calls[0][0]).toMatchObject({
      event: 'colo_probe',
      // info 而非 error：探针成功不是「错误」，混进 error 会把真正的问题在库里稀释掉
      level: 'info',
      message: 'entry=direct colo=HKG',
      detail: { entry: 'direct', colo: 'HKG', loc: 'HK', reason: 'launch' },
    })
  })

  it('探针自身失败**不产生任何记录**——否则它会污染自己要解释的那份数据', async () => {
    taroRequestMock.mockRejectedValue({ errMsg: 'request:fail timeout' })
    const { probeColo } = await loadProbe()

    await probeColo('failure')

    expect(reportClientErrorMock).not.toHaveBeenCalled()
  })

  it('拿到响应但没 colo（非 200 / 非文本）也不上报', async () => {
    const { probeColo } = await loadProbe()

    taroRequestMock.mockResolvedValue({ statusCode: 404, data: '' })
    await probeColo('launch')
    taroRequestMock.mockResolvedValue({ statusCode: 200, data: { not: 'text' } })
    await probeColo('launch')

    expect(reportClientErrorMock).not.toHaveBeenCalled()
  })

  it('同一设备 60 秒内只探一次（失败路径可能连着触发）', async () => {
    taroRequestMock.mockResolvedValue({ statusCode: 200, data: TRACE })
    const { probeColo } = await loadProbe()

    await probeColo('launch')
    await probeColo('failure')

    expect(taroRequestMock).toHaveBeenCalledTimes(1)
  })

  it('在飞期间不发第二次', async () => {
    let release: (v: unknown) => void = () => {}
    taroRequestMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const { probeColo } = await loadProbe()

    const first = probeColo('launch')
    const second = probeColo('failure')
    expect(taroRequestMock).toHaveBeenCalledTimes(1)

    release({ statusCode: 200, data: TRACE })
    await first
    await second
    expect(taroRequestMock).toHaveBeenCalledTimes(1)
  })

  describe('ttfb', () => {
    it('取 onHeadersReceived 的首字节时刻，不是总耗时', async () => {
      taroRequestMock.mockImplementation(() =>
        makeTask({ statusCode: 200, data: TRACE }, { ttfbMs: 5, totalMs: 40 })
      )
      const { probeColo } = await loadProbe()

      await probeColo('launch')

      const detail = reportsOf('colo_probe')[0].detail as Record<string, unknown>
      expect(typeof detail.ttfb).toBe('number')
      // 总耗时用「总耗时顶」的实现在这里会得到两个几乎相等的数
      expect(detail.ttfb as number).toBeLessThan(detail.ms as number)
      expect(detail.ttfbApprox).toBeUndefined()
    })

    it('平台不给 onHeadersReceived 时退回总耗时，并标 ttfbApprox 免得被当成首字节读', async () => {
      taroRequestMock.mockResolvedValue({ statusCode: 200, data: TRACE })
      const { probeColo } = await loadProbe()

      await probeColo('launch')

      const detail = reportsOf('colo_probe')[0].detail as Record<string, unknown>
      expect(detail.ttfb).toBeNull()
      expect(detail.ttfbApprox).toBe(true)
    })
  })

  describe('两条入口', () => {
    it('配了反代就两条各探一次，message 带 entry —— 否则两条会被指纹并成一条', async () => {
      taroRequestMock.mockResolvedValue({ statusCode: 200, data: TRACE })
      const { probeColo } = await loadProbe({ proxy: PROXY })

      await probeColo('launch')

      expect(taroRequestMock.mock.calls.map((c) => c[0].url)).toEqual([
        `${PROXY}/cdn-cgi/trace`,
        `${DIRECT}/cdn-cgi/trace`,
      ])
      const messages = reportsOf('colo_probe').map((r) => r.message)
      expect(messages).toEqual(['entry=proxy colo=HKG', 'entry=direct colo=HKG'])
      // 指纹是 event + message：两条的 message 必须不同，否则 5 分钟窗口里只剩一条
      expect(new Set(messages).size).toBe(2)
    })

    it('当前入口不可达、另一个可达 ⇒ 切过去并上报', async () => {
      taroRequestMock
        .mockRejectedValueOnce({ errMsg: 'request:fail' }) // proxy
        .mockResolvedValueOnce({ statusCode: 200, data: TRACE }) // direct
      const { probeColo } = await loadProbe({ proxy: PROXY })

      await probeColo('launch')

      expect(setStorageSyncMock).toHaveBeenCalledWith('pkuso_supabase_entry', 'direct')
      expect(reportsOf('entry_switched')).toHaveLength(1)
      // 探针**失败**那条仍然不上报（约束 2）：只有成功的那条进 colo_probe
      expect(reportsOf('colo_probe')).toHaveLength(1)
      expect(reportsOf('colo_probe')[0].detail.entry).toBe('direct')
    })

    it('**403 不算不可达**——链路明明通了，被 Referer 校验挡掉不等于入口坏了', async () => {
      taroRequestMock
        .mockResolvedValueOnce({ statusCode: 403, data: '{"error":"forbidden"}' }) // proxy
        .mockResolvedValueOnce({ statusCode: 200, data: TRACE }) // direct
      const { probeColo } = await loadProbe({ proxy: PROXY })

      await probeColo('launch')

      // 若拿「有没有 colo」当判据，这里会误切到直连——每次启动都切一次
      expect(setStorageSyncMock).not.toHaveBeenCalled()
      expect(reportsOf('entry_switched')).toHaveLength(0)
    })

    it('停在直连时，反代一旦恢复就切回去（没有这条就永远回不去了）', async () => {
      getStorageSyncMock.mockReturnValue('direct')
      taroRequestMock.mockResolvedValue({ statusCode: 200, data: TRACE })
      const { probeColo } = await loadProbe({ proxy: PROXY })

      await probeColo('launch')

      expect(setStorageSyncMock).toHaveBeenCalledWith('pkuso_supabase_entry', 'proxy')
      expect(reportsOf('entry_switched')[0].detail).toMatchObject({ from: 'direct', to: 'proxy' })
    })

    it('两个都通且当前就在反代上 ⇒ 不动（不无谓地在两个入口之间来回切）', async () => {
      taroRequestMock.mockResolvedValue({ statusCode: 200, data: TRACE })
      const { probeColo } = await loadProbe({ proxy: PROXY })

      await probeColo('launch')

      expect(setStorageSyncMock).not.toHaveBeenCalled()
      expect(reportsOf('entry_switched')).toHaveLength(0)
    })

    it('两个都不通 ⇒ 不切（那是设备侧的网断了，换域名救不了）', async () => {
      taroRequestMock.mockRejectedValue({ errMsg: 'request:fail' })
      const { probeColo } = await loadProbe({ proxy: PROXY })

      await probeColo('launch')

      expect(setStorageSyncMock).not.toHaveBeenCalled()
      expect(reportClientErrorMock).not.toHaveBeenCalled()
    })

    it('没配反代 ⇒ 只探一次，且不会有任何切换', async () => {
      taroRequestMock.mockResolvedValue({ statusCode: 200, data: TRACE })
      const { probeColo } = await loadProbe()

      await probeColo('launch')

      expect(taroRequestMock).toHaveBeenCalledTimes(1)
      expect(setStorageSyncMock).not.toHaveBeenCalled()
    })
  })
})
