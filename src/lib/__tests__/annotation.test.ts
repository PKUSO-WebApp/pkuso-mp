import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  annoStorageKey,
  compactDoc,
  compactStroke,
  loadAnnoDoc,
  saveAnnoDoc,
  type AnnoDoc,
} from '../annotation'

const storage = new Map<string, string>()

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: (key: string) => storage.get(key) ?? '',
    setStorageSync: (key: string, value: string) => {
      storage.set(key, value)
    },
  },
}))

describe('annotation storage', () => {
  beforeEach(() => {
    storage.clear()
  })

  it('annoStorageKey 按文件 id 生成独立键', () => {
    expect(annoStorageKey('abc')).toBe('score-annotation:abc')
    expect(annoStorageKey('a')).not.toBe(annoStorageKey('b'))
  })

  it('save/load 往返保留结构', () => {
    const doc: AnnoDoc = {
      '1': [
        {
          color: '#e5484d',
          width: 0.004,
          points: [
            [0.1, 0.2],
            [0.3, 0.4],
          ],
        },
      ],
      '2': [{ color: '#2f6fed', width: 0.008, points: [[0.5, 0.5]] }],
    }
    saveAnnoDoc('f1', doc)
    expect(loadAnnoDoc('f1')).toEqual(doc)
  })

  it('不同文件 id 批注互不串扰', () => {
    saveAnnoDoc('f1', { '1': [{ color: '#111', width: 0.004, points: [[0, 0]] }] })
    expect(loadAnnoDoc('f2')).toEqual({})
  })

  it('未写入时返回空文档', () => {
    expect(loadAnnoDoc('none')).toEqual({})
  })

  it('损坏 JSON 回退为空文档', () => {
    storage.set(annoStorageKey('bad'), '{not-json')
    expect(loadAnnoDoc('bad')).toEqual({})
  })

  it('合法 JSON 但非对象时回退为空文档', () => {
    storage.set(annoStorageKey('arr'), '[1,2,3]')
    expect(loadAnnoDoc('arr')).toEqual({})
    storage.set(annoStorageKey('str'), '"hi"')
    expect(loadAnnoDoc('str')).toEqual({})
  })
})

describe('annotation compaction', () => {
  beforeEach(() => {
    storage.clear()
  })

  it('save 时坐标压缩为 4 位小数', () => {
    saveAnnoDoc('f1', {
      '1': [{ color: '#111', width: 0.004, points: [[0.123456789, 0.987654321]] }],
    })
    const raw = JSON.parse(storage.get(annoStorageKey('f1')) ?? '{}') as AnnoDoc
    expect(raw['1'][0].points).toEqual([[0.1235, 0.9877]])
  })

  it('近重复点被过滤，首末点必留', () => {
    const s = compactStroke({
      color: '#111',
      width: 0.004,
      points: [
        [0, 0],
        [0.0002, 0.0002],
        [0.0004, 0.0004],
        [0.5, 0.5],
      ],
    })
    expect(s.points).toEqual([
      [0, 0],
      [0.5, 0.5],
    ])
  })

  it('末点与上一保留点完全重合时去重', () => {
    const s = compactStroke({
      color: '#111',
      width: 0.004,
      points: [
        [0.1, 0.1],
        [0.1, 0.1],
      ],
    })
    expect(s.points).toEqual([[0.1, 0.1]])
  })

  it('单点笔迹与空笔迹原样保留', () => {
    expect(compactStroke({ color: '#111', width: 0.004, points: [[0.3, 0.7]] }).points).toEqual([
      [0.3, 0.7],
    ])
    expect(compactStroke({ color: '#111', width: 0.004, points: [] }).points).toEqual([])
  })

  it('load 时压缩历史全精度数据', () => {
    storage.set(
      annoStorageKey('old'),
      JSON.stringify({ '1': [{ color: '#111', width: 0.004, points: [[0.1234567890123, 0.4]] }] })
    )
    expect(loadAnnoDoc('old')['1'][0].points).toEqual([[0.1235, 0.4]])
  })

  it('compactDoc 幂等', () => {
    const doc: AnnoDoc = {
      '1': [
        {
          color: '#111',
          width: 0.004,
          points: [
            [0.123456789, 0.5],
            [0.1238, 0.5],
            [0.9, 0.1],
          ],
        },
      ],
    }
    const once = compactDoc(doc)
    expect(compactDoc(once)).toEqual(once)
  })

  it('坏条目降级为空数组', () => {
    storage.set(annoStorageKey('bad'), JSON.stringify({ '1': 'junk' }))
    expect(loadAnnoDoc('bad')).toEqual({ '1': [] })
  })
})
