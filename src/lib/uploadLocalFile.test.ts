// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readTempFileBytes, uploadLocalFile } from './uploadLocalFile'

// 模拟微信 readFile：用 success({ data }) 返回不同基础库下的数据类型
const readFileMock = vi.fn()
vi.mock('@tarojs/taro', () => ({
  default: {
    getFileSystemManager: () => ({ readFile: readFileMock }),
  },
}))

beforeEach(() => {
  readFileMock.mockReset()
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
  it('base64 字符串读出字节后，上传请求体为真正的 ArrayBuffer', async () => {
    readFileMock.mockImplementation((opts: any) => opts.success({ data: 'QQ==' }))
    const upload = vi.fn().mockResolvedValue({ data: { path: 'u1/1-a.png' }, error: null })
    const client: any = { storage: { from: () => ({ upload }) } }

    const res = await uploadLocalFile(client, 'leave-attachments', 'u1/1-a.png', 'wxfile://tmp/a.png', 'image/png')

    expect(res.error).toBeNull()
    expect(res.data).toEqual({ path: 'u1/1-a.png' })
    // 关键断言：上传收到的 body 必须是真正 ArrayBuffer，否则 toTaroBody 会抛「不支持该请求体类型」
    expect(upload.mock.calls[0][1]).toBeInstanceOf(ArrayBuffer)
  })
})
