import { beforeEach, describe, expect, it, vi } from 'vitest'
import { storageUploadAttempts, uploadStorageObject } from './storage-upload'

const { getStorageSync, setStorageSync, requestMock } = vi.hoisted(() => ({
  getStorageSync: vi.fn(() => ''),
  setStorageSync: vi.fn(),
  requestMock: vi.fn(),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync,
    setStorageSync,
    request: requestMock,
  },
}))

vi.hoisted(() => {
  process.env.TARO_APP_SUPABASE_URL = 'https://project.supabase.co'
  process.env.TARO_APP_SUPABASE_PROXY_URL = 'https://proxy.example.com'
  process.env.TARO_APP_SUPABASE_ANON_KEY = 'anon-key'
})

const client: any = {
  auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
}
const body = new Uint8Array([1, 2, 3]).buffer

beforeEach(() => {
  requestMock.mockReset()
  getStorageSync.mockReturnValue('')
  setStorageSync.mockReset()
})

describe('storageUploadAttempts', () => {
  it('配了反代时反代优先、直连兜底；路径编码不吞 slash', () => {
    const attempts = storageUploadAttempts('leave-attachments', 'u/a b.png')
    expect(attempts.map((a) => a.entry)).toEqual(['proxy', 'direct'])
    expect(attempts[0].url).toBe(
      'https://proxy.example.com/storage/v1/object/leave-attachments/u/a%20b.png'
    )
    expect(attempts[1].url).toBe(
      'https://project.supabase.co/storage/v1/object/leave-attachments/u/a%20b.png'
    )
  })
})

describe('uploadStorageObject', () => {
  it('反代成功时不打直连', async () => {
    requestMock.mockImplementation((opts: any) =>
      opts.success({ statusCode: 200, data: '{"Key":"a"}' })
    )

    const res = await uploadStorageObject({
      client,
      bucket: 'leave-attachments',
      path: 'u/a.png',
      body,
    })

    expect(res.ok).toBe(true)
    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(requestMock.mock.calls[0][0].url).toContain('proxy.example.com')
    expect(new Uint8Array(requestMock.mock.calls[0][0].data)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('反代网络失败后换直连，第二条腿 body 仍完整', async () => {
    requestMock
      .mockImplementationOnce((opts: any) => opts.fail({ errMsg: 'request:fail timeout' }))
      .mockImplementationOnce((opts: any) => opts.success({ statusCode: 200, data: '{}' }))

    const res = await uploadStorageObject({
      client,
      bucket: 'leave-attachments',
      path: 'u/a.png',
      body,
    })

    expect(res.ok).toBe(true)
    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(requestMock.mock.calls[1][0].url).toContain('project.supabase.co')
    expect(new Uint8Array(requestMock.mock.calls[1][0].data)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('幂等路径下第二条腿的 Duplicate 视为成功', async () => {
    requestMock
      .mockImplementationOnce((opts: any) => opts.fail({ errMsg: 'request:fail timeout' }))
      .mockImplementationOnce((opts: any) =>
        opts.success({
          statusCode: 400,
          data: '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}',
        })
      )

    const res = await uploadStorageObject({
      client,
      bucket: 'leave-attachments',
      path: 'u/a.png',
      body,
      idempotent: true,
    })

    expect(res.ok).toBe(true)
  })

  it('非幂等路径的 Duplicate 不吞', async () => {
    requestMock.mockImplementation((opts: any) =>
      opts.success({
        statusCode: 400,
        data: '{"error":"Duplicate","message":"The resource already exists"}',
      })
    )

    const res = await uploadStorageObject({
      client,
      bucket: 'avatar_images',
      path: 'u/avatar.jpg',
      body,
      upsert: false,
      idempotent: false,
    })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.message).toContain('already exists')
  })
})
