import { describe, expect, it } from 'vitest'
import { isShareDocKey, parseAnnotationDocKey, shareDocKey } from './annotation-doc'

describe('批注文档键（0.6.1 共享副本）', () => {
  it('普通文件：裸 uuid 原样当 file，旧键逐字兼容', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(parseAnnotationDocKey(id)).toEqual({ kind: 'file', id })
    expect(isShareDocKey(id)).toBe(false)
  })

  it('共享副本：share:<id> ↔ { kind: share, id }', () => {
    const id = '22222222-2222-4222-8222-222222222222'
    const key = shareDocKey(id)
    expect(key).toBe(`share:${id}`)
    expect(parseAnnotationDocKey(key)).toEqual({ kind: 'share', id })
    expect(isShareDocKey(key)).toBe(true)
  })

  it('只认前缀，不做 uuid 校验（解析层不负责合法性）', () => {
    expect(parseAnnotationDocKey('share:abc')).toEqual({ kind: 'share', id: 'abc' })
    expect(parseAnnotationDocKey('abc')).toEqual({ kind: 'file', id: 'abc' })
  })
})
