import { describe, expect, it, vi } from 'vitest'
import { AnnotatedPdfError, composeAnnotatedPdf } from './annotated-pdf'

// 这个模块 import 了 supabase，而后者在缺 env 时**导入即抛** ⇒ 必须桩掉（仓里的惯例）
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))

type InvokeResult = { data: unknown; error: unknown }

/** 造一个 invoke 桩；`calls` 记下每次的入参 */
function fakeInvoke(result: InvokeResult) {
  const calls: Array<{ name: string; body: unknown }> = []
  const fn = async (name: string, opts: { body: Record<string, unknown> }) => {
    calls.push({ name, body: opts.body })
    return result
  }
  return { calls, fn }
}

/** 服务端的错误响应体（`FunctionsHttpError` 把 Response 挂在 `context` 上） */
const httpError = (message: string, body: unknown) => ({
  message,
  context: { json: async () => body },
})

describe('composeAnnotatedPdf', () => {
  it('成功：带上 file_id 调对函数，返回签名 URL 与字节数', async () => {
    const { calls, fn } = fakeInvoke({
      data: { url: 'https://x.supabase.co/storage/v1/object/sign/a.pdf?token=t', bytes: 12345, annotatedPages: 3, drawnStrokes: 42 },
      error: null,
    })

    const out = await composeAnnotatedPdf('file-1', fn)

    expect(calls).toEqual([{ name: 'compose-annotated-pdf', body: { file_id: 'file-1' } }])
    expect(out.url).toContain('token=t')
    expect(out.bytes).toBe(12345)
    expect(out.annotatedPages).toBe(3)
    expect(out.drawnStrokes).toBe(42)
  })

  it('error 有值 ⇒ 抛，且把服务端那句 error 带出来', async () => {
    const { fn } = fakeInvoke({
      data: null,
      error: httpError('Edge Function returned a non-2xx status code', { error: 'no annotations' }),
    })

    await expect(composeAnnotatedPdf('f', fn)).rejects.toThrow(/no annotations/)
  })

  it('可预期的业务错误码能认出来（上层据此给一句人话，而不是当失败上报）', async () => {
    const { fn } = fakeInvoke({
      data: null,
      error: httpError('non-2xx', { error: 'no annotations' }),
    })

    await expect(composeAnnotatedPdf('f', fn)).rejects.toMatchObject({
      name: 'AnnotatedPdfError',
      code: 'no annotations',
    })
  })

  it('别的服务端错误归到 unknown，原话仍保留', async () => {
    const { fn } = fakeInvoke({
      data: null,
      error: httpError('non-2xx', { error: 'failed to compose pdf' }),
    })

    const err = await composeAnnotatedPdf('f', fn).then(
      () => {
        throw new Error('本该失败却成功了')
      },
      (e: AnnotatedPdfError) => e
    )
    expect(err.code).toBe('unknown')
    expect(err.message).toContain('failed to compose pdf')
  })

  it('error 是空的但响应体没有 url ⇒ 照样抛（这条是「静默下到空文件」的唯一闸）', async () => {
    const { fn } = fakeInvoke({ data: { bytes: 0 }, error: null })

    await expect(composeAnnotatedPdf('f', fn)).rejects.toThrow(/没有 url/)
  })

  it('data 整个是 null（invoke 吞错的典型形态）⇒ 抛，不当成功', async () => {
    const { fn } = fakeInvoke({ data: null, error: null })

    await expect(composeAnnotatedPdf('f', fn)).rejects.toThrow(/没有 url/)
  })

  it('响应体不是 JSON（context.json 抛）⇒ 仍用基础那句话抛出来', async () => {
    const { fn } = fakeInvoke({
      data: null,
      error: { message: 'non-2xx', context: { json: async () => { throw new Error('not json') } } },
    })

    await expect(composeAnnotatedPdf('f', fn)).rejects.toThrow(/non-2xx/)
  })
})
