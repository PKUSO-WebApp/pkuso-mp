// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readTempFileBytes, uploadLocalFile } from './uploadLocalFile'

// storage-entry 在模块求值时读 env；hoisted 保证早于 import 执行
vi.hoisted(() => {
  process.env.TARO_APP_SUPABASE_URL = 'https://project.supabase.co'
  process.env.TARO_APP_SUPABASE_PROXY_URL = 'https://proxy.example.com'
  process.env.TARO_APP_SUPABASE_ANON_KEY = 'anon-key'
})

// 模拟微信 readFile / request：用 success({ data }) 返回不同基础库下的数据类型
const { readFileMock, requestMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  requestMock: vi.fn(),
}))
vi.mock('@tarojs/taro', () => ({
  default: {
    getFileSystemManager: () => ({ readFile: readFileMock }),
    request: requestMock,
  },
}))

beforeEach(() => {
  readFileMock.mockReset()
  requestMock.mockReset()
})

describe('readTempFileBytes', () => {
  it('ArrayBuffer 直接返回', async () => {
    const ab = new Uint8Array([1, 2, 3, 4]).buffer
    readFileMock.mockImplementation((opts: any) => opts.success({ data: ab }))
    const result = await readTempFileBytes('wxfile://tmp/a.png')
    expect(result).toBe(ab)
  })

  it('Uint8Array（ArrayBufferView）取底层 buffer', async () => {
    const u = new Uint8Array([5, 6, 7])
    readFileMock.mockImplementation((opts: any) => opts.success({ data: u }))
    const result = await readTempFileBytes('wxfile://tmp/b.png')
    expect(result).toBeInstanceOf(ArrayBuffer)
    expect(result.byteLength).toBe(3)
  })

  it('DataView（ArrayBufferView）取底层 buffer', async () => {
    const dv = new DataView(new Uint8Array([11, 12, 13]).buffer)
    readFileMock.mockImplementation((opts: any) => opts.success({ data: dv }))
    const result = await readTempFileBytes('wxfile://tmp/d.png')
    expect(result).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(result)[0]).toBe(11)
  })

  it('base64 字符串解码为 ArrayBuffer（微信实测返回类型）', async () => {
    // 'QQ==' 是 'A' (0x41) 的 base64
    readFileMock.mockImplementation((opts: any) => opts.success({ data: 'QQ==' }))
    const result = await readTempFileBytes('wxfile://tmp/c.png')
    expect(result).toBeInstanceOf(ArrayBuffer)
    const view = new Uint8Array(result)
    expect(view.length).toBe(1)
    expect(view[0]).toBe(0x41)
  })

  it('读取失败 reject', async () => {
    readFileMock.mockImplementation((opts: any) => opts.fail({ errMsg: 'fail' }))
    await expect(readTempFileBytes('x')).rejects.toThrow()
  })
})

describe('uploadLocalFile（端到端）', () => {
  const client: any = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
  }

  it('base64 字符串读出字节后，上传请求体为真正的 ArrayBuffer', async () => {
    readFileMock.mockImplementation((opts: any) => opts.success({ data: 'QQ==' }))
    requestMock.mockImplementation((opts: any) => opts.success({ statusCode: 200, data: '{}' }))

    const res = await uploadLocalFile(
      client,
      'leave-attachments',
      'u1/1-a.png',
      'wxfile://tmp/a.png',
      'image/png'
    )

    expect(res.error).toBeNull()
    expect(res.data).toEqual({ path: 'u1/1-a.png' })
    // 关键断言：上传收到的 body 必须是真正 ArrayBuffer，否则小程序请求层会判为不支持
    expect(requestMock.mock.calls[0][0].data).toBeInstanceOf(ArrayBuffer)
    expect(requestMock.mock.calls[0][0].url).toContain(
      '/storage/v1/object/leave-attachments/u1/1-a.png'
    )
  })

  it('idempotent 时在文件名前插入内容指纹，且 body 字节不变', async () => {
    readFileMock.mockImplementation((opts: any) => opts.success({ data: 'QQ==' }))
    requestMock.mockImplementation((opts: any) => opts.success({ statusCode: 200, data: '{}' }))

    const res = await uploadLocalFile(
      client,
      'leave-attachments',
      'u1/form-key-a.png',
      'wxfile://tmp/a.png',
      'image/png',
      false,
      undefined,
      { idempotent: true }
    )

    expect(res.error).toBeNull()
    expect(res.data?.path).toMatch(/^u1\/[0-9a-f]{16}-form-key-a\.png$/)
    const body = requestMock.mock.calls[0][0].data as ArrayBuffer
    expect(new Uint8Array(body)).toEqual(new Uint8Array([0x41]))
  })

  it('代理腿失败后自动换直连，第二条腿仍拿到完整 body', async () => {
    readFileMock.mockImplementation((opts: any) => opts.success({ data: 'QQ==' }))
    requestMock
      .mockImplementationOnce((opts: any) => opts.fail({ errMsg: 'request:fail timeout' }))
      .mockImplementationOnce((opts: any) => opts.success({ statusCode: 200, data: '{}' }))

    const res = await uploadLocalFile(
      client,
      'leave-attachments',
      'u1/1-a.png',
      'wxfile://tmp/a.png',
      'image/png'
    )

    expect(res.error).toBeNull()
    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(new Uint8Array(requestMock.mock.calls[1][0].data)).toEqual(new Uint8Array([0x41]))
  })
})
