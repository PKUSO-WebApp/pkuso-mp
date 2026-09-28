import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { taroRequestMock, reportClientErrorMock } = vi.hoisted(() => ({
  taroRequestMock: vi.fn(),
  reportClientErrorMock: vi.fn(),
}))

vi.mock('@tarojs/taro', () => ({ default: { request: taroRequestMock } }))
// error-report 会连带 import supabase（缺环境变量时模块加载即抛），这里只替掉它的上报口
vi.mock('@/lib/error-report', () => ({ reportClientError: reportClientErrorMock }))
vi.mock('@/lib/session-diag', () => ({ logDiag: vi.fn() }))

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

describe('Cloudflare PoP 探针', () => {
  beforeEach(async () => {
    const { __resetColoProbeForTest } = await import('@/lib/colo-probe')
    __resetColoProbeForTest()
    taroRequestMock.mockReset()
    reportClientErrorMock.mockReset()
    vi.stubEnv('TARO_APP_SUPABASE_URL', 'https://x.supabase.co')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('解析 colo / loc；畸形行不抛', async () => {
    const { parseColoTrace } = await import('@/lib/colo-probe')
    expect(parseColoTrace(TRACE)).toEqual({ colo: 'HKG', loc: 'HK' })
    // 空响应、空行、没有 '=' 的行、值为空 —— 一律退化成 null，由调用方丢弃
    expect(parseColoTrace('')).toEqual({ colo: null, loc: null })
    expect(parseColoTrace('garbage\n=novalue\ncolo=\nloc')).toEqual({ colo: null, loc: null })
  })

  it('成功时把落点上报到服务端——边缘应答不落 origin，这是库端唯一的落点证据', async () => {
    taroRequestMock.mockResolvedValue({ statusCode: 200, data: TRACE })
    const { probeColo } = await import('@/lib/colo-probe')

    await probeColo('launch')

    expect(taroRequestMock).toHaveBeenCalledTimes(1)
    expect(taroRequestMock.mock.calls[0][0]).toMatchObject({
      url: 'https://x.supabase.co/cdn-cgi/trace',
    })
    expect(reportClientErrorMock).toHaveBeenCalledTimes(1)
    expect(reportClientErrorMock.mock.calls[0][0]).toMatchObject({
      event: 'colo_probe',
      // info 而非 error：探针成功不是「错误」，混进 error 会把真正的问题在库里稀释掉
      level: 'info',
      message: 'colo=HKG',
      detail: { colo: 'HKG', loc: 'HK', reason: 'launch' },
    })
  })

  it('探针自身失败**不产生任何记录**——否则它会污染自己要解释的那份数据', async () => {
    taroRequestMock.mockRejectedValue({ errMsg: 'request:fail timeout' })
    const { probeColo } = await import('@/lib/colo-probe')

    await probeColo('failure')

    expect(reportClientErrorMock).not.toHaveBeenCalled()
  })

  it('拿到响应但没 colo（非 200 / 非文本）也不上报', async () => {
    const { probeColo } = await import('@/lib/colo-probe')

    taroRequestMock.mockResolvedValue({ statusCode: 404, data: '' })
    await probeColo('launch')
    taroRequestMock.mockResolvedValue({ statusCode: 200, data: { not: 'text' } })
    await probeColo('launch')

    expect(reportClientErrorMock).not.toHaveBeenCalled()
  })

  it('同一设备 60 秒内只探一次（失败路径可能连着触发）', async () => {
    taroRequestMock.mockResolvedValue({ statusCode: 200, data: TRACE })
    const { probeColo } = await import('@/lib/colo-probe')

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
    const { probeColo } = await import('@/lib/colo-probe')

    const first = probeColo('launch')
    const second = probeColo('failure')
    expect(taroRequestMock).toHaveBeenCalledTimes(1)

    release({ statusCode: 200, data: TRACE })
    await first
    await second
    expect(taroRequestMock).toHaveBeenCalledTimes(1)
  })
})
