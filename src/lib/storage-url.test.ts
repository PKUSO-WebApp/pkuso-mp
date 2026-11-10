import { beforeEach, describe, expect, it, vi } from 'vitest'
import { storageUrlCandidates } from './storage-url'
import { __resetEntryForTest, switchTo } from './supabase-entry'

const { getStorageSync, setStorageSync } = vi.hoisted(() => ({
  getStorageSync: vi.fn(() => ''),
  setStorageSync: vi.fn(),
}))

vi.mock('@tarojs/taro', () => ({ default: { getStorageSync, setStorageSync } }))

vi.hoisted(() => {
  process.env.TARO_APP_SUPABASE_URL = 'https://project.supabase.co'
  process.env.TARO_APP_SUPABASE_PROXY_URL = 'https://proxy.example.com'
  process.env.TARO_APP_SUPABASE_ANON_KEY = 'anon-key'
})

const DIRECT = 'https://project.supabase.co'
const PROXY = 'https://proxy.example.com'

beforeEach(() => {
  __resetEntryForTest()
})

describe('storageUrlCandidates', () => {
  it('当前入口是反代：proxy 优先、direct 兜底', () => {
    expect(storageUrlCandidates(`${DIRECT}/storage/v1/object/public/avatar/u/a.jpg`)).toEqual([
      `${PROXY}/storage/v1/object/public/avatar/u/a.jpg`,
      `${DIRECT}/storage/v1/object/public/avatar/u/a.jpg`,
    ])
  })

  it('当前入口是直连：direct 优先、proxy 兜底', () => {
    switchTo('direct')
    expect(storageUrlCandidates(`${DIRECT}/storage/v1/object/public/avatar/u/a.jpg`)).toEqual([
      `${DIRECT}/storage/v1/object/public/avatar/u/a.jpg`,
      `${PROXY}/storage/v1/object/public/avatar/u/a.jpg`,
    ])
  })

  it('头像 URL（avatar_images + 缓存戳）也走反代优先', () => {
    const url = `${DIRECT}/storage/v1/object/public/avatar_images/u1/avatar.jpg?t=123`
    expect(storageUrlCandidates(url)).toEqual([
      `${PROXY}/storage/v1/object/public/avatar_images/u1/avatar.jpg?t=123`,
      url,
    ])
  })

  it('签名 URL 的 query 原样保留', () => {
    const urls = storageUrlCandidates(
      `${DIRECT}/storage/v1/object/sign/leave-attachments/u/a.jpg?token=abc.def`
    )
    expect(urls[0]).toBe(`${PROXY}/storage/v1/object/sign/leave-attachments/u/a.jpg?token=abc.def`)
    expect(urls[1]).toBe(`${DIRECT}/storage/v1/object/sign/leave-attachments/u/a.jpg?token=abc.def`)
  })

  it('非本项目 URL 原样返回一条', () => {
    expect(storageUrlCandidates('https://example.com/a.jpg')).toEqual(['https://example.com/a.jpg'])
    expect(storageUrlCandidates('wxfile://tmp/a.jpg')).toEqual(['wxfile://tmp/a.jpg'])
  })

  it('空值返回空列表', () => {
    expect(storageUrlCandidates(null)).toEqual([])
    expect(storageUrlCandidates('')).toEqual([])
  })
})
