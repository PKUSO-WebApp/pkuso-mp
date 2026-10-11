import { describe, expect, it } from 'vitest'
import {
  albumStorageKey,
  ALBUM_KEY_PREFIX,
  loadAliveAlbum,
  MAX_ALBUMS,
  MAX_PAGES,
  parseAlbum,
  pickAlbumEvictions,
  saveAlbum,
  type PageFileStoreDeps,
} from './page-file-store'

/** 假 Storage + 假文件系统：只记调用，够验「写了什么、探了谁」 */
function fakeDeps(seed: Record<string, string> = {}, alive: string[] = []) {
  const store = new Map(Object.entries(seed))
  const aliveSet = new Set(alive)
  const calls: string[] = []
  const deps: PageFileStoreDeps = {
    get: (k) => store.get(k) ?? '',
    set: (k, v) => {
      store.set(k, v)
      calls.push(`set:${k}`)
    },
    remove: (k) => {
      store.delete(k)
      calls.push(`remove:${k}`)
    },
    keys: () => [...store.keys()],
    access: async (p) => {
      calls.push(`access:${p}`)
      return aliveSet.has(p)
    },
  }
  return { deps, store, calls }
}

const rec = (t: number, p: string[]) => JSON.stringify({ t, p })

describe('parseAlbum', () => {
  it('正常一条：时间戳 + 路径数组', () => {
    expect(parseAlbum(rec(123, ['/a.jpg', '', '/c.jpg']))).toEqual({
      t: 123,
      p: ['/a.jpg', '', '/c.jpg'],
    })
  })

  it('坏数据一律当「没有」（Storage 里可能是别的版本写的、或被人手改过）', () => {
    expect(parseAlbum('')).toBeNull()
    expect(parseAlbum(null)).toBeNull()
    expect(parseAlbum(undefined)).toBeNull()
    expect(parseAlbum(123)).toBeNull()
    expect(parseAlbum('{')).toBeNull()
    expect(parseAlbum('[]')).toBeNull() // 顶层是数组
    expect(parseAlbum('{"t":1}')).toBeNull() // 没有 p
    expect(parseAlbum('{"p":"x"}')).toBeNull() // p 不是数组
  })

  it('数组里的非字符串元素当「没有这一页」，而不是整条作废', () => {
    expect(parseAlbum('{"t":1,"p":["/a.jpg",null,7,{"x":1}]}')?.p).toEqual(['/a.jpg', '', '', ''])
  })

  it('时间戳非法时归零（只影响 LRU 顺序，不影响能不能用）', () => {
    expect(parseAlbum('{"t":"x","p":["/a.jpg"]}')?.t).toBe(0)
    expect(parseAlbum('{"p":["/a.jpg"]}')?.t).toBe(0)
  })

  it('超长数组截断到 MAX_PAGES', () => {
    const long = Array.from({ length: MAX_PAGES + 50 }, (_, i) => `/p${i}.jpg`)
    expect(parseAlbum(rec(1, long))?.p).toHaveLength(MAX_PAGES)
  })
})

describe('pickAlbumEvictions', () => {
  const e = (key: string, t: number) => ({ key, t })

  it('没超上限就不淘汰', () => {
    expect(pickAlbumEvictions([e('a', 1), e('b', 2)], 2)).toEqual([])
    expect(pickAlbumEvictions([e('a', 1), e('b', 2)], 5)).toEqual([])
  })

  it('超了就按最近使用时间删最旧的几个', () => {
    const keys = pickAlbumEvictions([e('a', 5), e('b', 1), e('c', 9), e('d', 3)], 2)
    expect(keys).toEqual(['b', 'd']) // t=1 最旧、t=3 次之
  })

  it('输入顺序打乱也按时间戳判（不是按传入次序）', () => {
    expect(pickAlbumEvictions([e('newest', 100), e('oldest', 1), e('mid', 50)], 2)).toEqual([
      'oldest',
    ])
  })
})

describe('loadAliveAlbum', () => {
  const key = albumStorageKey('f1')

  it('没记过的册：返回全空，且**不探活也不写**（不留空账）', async () => {
    const { deps, calls } = fakeDeps()
    const paths = await loadAliveAlbum('f1', 3, deps, 100)
    expect(paths).toEqual(['', '', ''])
    expect(calls).toEqual([])
  })

  it('探活通过的留下、文件没了的清掉，并写回结果', async () => {
    const { deps, store } = fakeDeps({ [key]: rec(1, ['/a.jpg', '/gone.jpg', '/c.jpg']) }, [
      '/a.jpg',
      '/c.jpg',
    ])
    const paths = await loadAliveAlbum('f1', 3, deps, 100)
    expect(paths).toEqual(['/a.jpg', '', '/c.jpg'])
    expect(JSON.parse(store.get(key) ?? '{}')).toEqual({ t: 100, p: ['/a.jpg', '', '/c.jpg'] })
  })

  it('打开一册就算「最近用过」：没有变化也把时间戳推上去', async () => {
    const { deps, store } = fakeDeps({ [key]: rec(1, ['/a.jpg']) }, ['/a.jpg'])
    await loadAliveAlbum('f1', 1, deps, 999)
    expect(JSON.parse(store.get(key) ?? '{}').t).toBe(999)
  })

  it('一条都不剩（文件全被平台清了）⇒ 把这条账删掉', async () => {
    const { deps, store } = fakeDeps({ [key]: rec(1, ['/a.jpg']) }, [])
    expect(await loadAliveAlbum('f1', 1, deps, 100)).toEqual([''])
    expect(store.has(key)).toBe(false)
  })

  it('页数比记账多/少都对齐到请求的页数', async () => {
    const { deps } = fakeDeps({ [key]: rec(1, ['/a.jpg']) }, ['/a.jpg'])
    expect(await loadAliveAlbum('f1', 3, deps, 1)).toEqual(['/a.jpg', '', ''])
    const { deps: d2 } = fakeDeps({ [key]: rec(1, ['/a.jpg', '/b.jpg', '/c.jpg']) }, [
      '/a.jpg',
      '/b.jpg',
      '/c.jpg',
    ])
    expect(await loadAliveAlbum('f1', 2, d2, 1)).toEqual(['/a.jpg', '/b.jpg'])
  })

  it('没有 fileId / 页数为 0：直接返回空，连 Storage 都不读', async () => {
    const { deps, calls } = fakeDeps({ [key]: rec(1, ['/a.jpg']) }, ['/a.jpg'])
    expect(await loadAliveAlbum('', 3, deps, 1)).toEqual(['', '', ''])
    expect(await loadAliveAlbum('f1', 0, deps, 1)).toEqual([])
    expect(calls).toEqual([])
  })
})

describe('saveAlbum', () => {
  it('写回这一册的路径', () => {
    const { deps, store } = fakeDeps()
    saveAlbum('f1', ['/a.jpg', '', '/c.jpg'], deps, 42)
    expect(JSON.parse(store.get(albumStorageKey('f1')) ?? '{}')).toEqual({
      t: 42,
      p: ['/a.jpg', '', '/c.jpg'],
    })
  })

  it('一条都没有 ⇒ 删掉这条账（别留空账）', () => {
    const { deps, store } = fakeDeps({ [albumStorageKey('f1')]: rec(1, ['/a.jpg']) })
    saveAlbum('f1', ['', ''], deps, 42)
    expect(store.has(albumStorageKey('f1'))).toBe(false)
  })

  it('没有 fileId 时什么都不做', () => {
    const { deps, calls } = fakeDeps()
    saveAlbum('', ['/a.jpg'], deps, 1)
    expect(calls).toEqual([])
  })

  it('超出 MAX_ALBUMS 册时按最近使用淘汰最旧的那些', () => {
    const seed: Record<string, string> = {}
    for (let i = 0; i < MAX_ALBUMS; i += 1) {
      seed[`${ALBUM_KEY_PREFIX}old${i}`] = rec(i + 1, [`/p${i}.jpg`])
    }
    const { deps, store } = fakeDeps(seed)
    saveAlbum('new', ['/new.jpg'], deps, 10_000)
    // 新增一册 ⇒ 超 1 ⇒ 删掉 t 最小的那一册（t = 1 的 old0）
    expect([...store.keys()]).toHaveLength(MAX_ALBUMS)
    expect(store.has(`${ALBUM_KEY_PREFIX}old0`)).toBe(false)
    expect(store.has(albumStorageKey('new'))).toBe(true)
  })

  it('只数自己的键：别人的 Storage 键不参与淘汰', () => {
    const { deps, store } = fakeDeps({ 'pkuso:anno:f1': 'xxx', 'some-other': 'y' })
    saveAlbum('f1', ['/a.jpg'], deps, 1)
    expect(store.has('pkuso:anno:f1')).toBe(true)
    expect(store.has('some-other')).toBe(true)
  })
})
