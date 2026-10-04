import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cachedPdfPath,
  pdfCacheKey,
  pdfCachePath,
  pdfCacheTag,
  pickEvictions,
  readCachedPdf,
  writeCachedPdf,
  PDF_CACHE_BUDGET_BYTES,
  type PdfCacheEntry,
} from './pdf-cache'

// vi.mock 会被提升到文件顶部，工厂里不能引用普通顶层变量——用 vi.hoisted 一起提起
const taro = vi.hoisted(() => ({
  env: { USER_DATA_PATH: '/udp' },
  getStorageSync: vi.fn(),
  setStorageSync: vi.fn(),
  getFileSystemManager: vi.fn(),
}))
vi.mock('@tarojs/taro', () => ({ default: taro }))

/** 让 readFile/writeFile 按用例设定的行为回调 */
function fileSystem(opts: { readData?: ArrayBuffer; readFails?: boolean; writeFails?: boolean }) {
  return {
    readFile: ({
      success,
      fail,
    }: {
      success: (r: { data: ArrayBuffer }) => void
      fail: (e: Error) => void
    }) => {
      if (opts.readFails) fail(new Error('read failed'))
      else success({ data: opts.readData ?? new ArrayBuffer(8) })
    },
    writeFile: ({ success, fail }: { success: () => void; fail: () => void }) => {
      if (opts.writeFails) fail()
      else success()
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('缓存键与指纹', () => {
  it('键按 fileId 区分，路径落在用户目录', () => {
    expect(pdfCacheKey('abc')).toBe('score-pdf-cache:abc')
    expect(pdfCachePath('abc')).toBe('/udp/score-abc.pdf')
  })

  it('指纹 = storage_path + 文件大小（换文件必换大小）', () => {
    expect(pdfCacheTag({ storage_path: 'p/a.pdf', file_size: 123 } as never)).toBe('p/a.pdf|123')
  })

  it('file_size 为 null 时按 0 记（不产出 undefined）', () => {
    expect(pdfCacheTag({ storage_path: 'p/a.pdf', file_size: null } as never)).toBe('p/a.pdf|0')
  })
})

describe('readCachedPdf', () => {
  it('没有记录 → null（回落网络）', async () => {
    taro.getStorageSync.mockReturnValue('')
    expect(await readCachedPdf('abc', 'tag')).toBeNull()
  })

  it('指纹不符 → null（换了文件就当没有缓存）', async () => {
    taro.getStorageSync.mockReturnValue({ tag: '旧指纹' })
    expect(await readCachedPdf('abc', '新指纹')).toBeNull()
  })

  it('指纹相符 → 读出本地字节', async () => {
    taro.getStorageSync.mockReturnValue({ tag: 'tag' })
    const bytes = new ArrayBuffer(16)
    taro.getFileSystemManager.mockReturnValue(fileSystem({ readData: bytes }))
    expect(await readCachedPdf('abc', 'tag')).toBe(bytes)
  })

  it('读文件失败 → null（缓存是优化，不该让阅读失败）', async () => {
    taro.getStorageSync.mockReturnValue({ tag: 'tag' })
    taro.getFileSystemManager.mockReturnValue(fileSystem({ readFails: true }))
    expect(await readCachedPdf('abc', 'tag')).toBeNull()
  })

  it('storage 抛错 → null', async () => {
    taro.getStorageSync.mockImplementation(() => {
      throw new Error('storage broken')
    })
    expect(await readCachedPdf('abc', 'tag')).toBeNull()
  })
})

describe('writeCachedPdf', () => {
  it('写成功后落下指纹', () => {
    taro.getFileSystemManager.mockReturnValue(fileSystem({}))
    writeCachedPdf('abc', 'tag', new ArrayBuffer(4))
    expect(taro.setStorageSync).toHaveBeenCalledWith('score-pdf-cache:abc', { tag: 'tag' })
  })

  it('写失败不落指纹（下次仍会回落网络重下）', () => {
    taro.getFileSystemManager.mockReturnValue(fileSystem({ writeFails: true }))
    writeCachedPdf('abc', 'tag', new ArrayBuffer(4))
    // 只看指纹 key：写失败时账本（index）仍会被写一次（记下「这份没进缓存」）
    expect(taro.setStorageSync).not.toHaveBeenCalledWith('score-pdf-cache:abc', expect.anything())
  })

  it('文件系统抛错时静默（不影响阅读）', () => {
    taro.getFileSystemManager.mockImplementation(() => {
      throw new Error('fs broken')
    })
    expect(() => writeCachedPdf('abc', 'tag', new ArrayBuffer(4))).not.toThrow()
  })
})

describe('pickEvictions（自管 LRU）', () => {
  const e = (fileId: string, size: number, at: number): PdfCacheEntry => ({
    fileId,
    tag: 't',
    size,
    at,
  })

  it('没超预算就不淘汰', () => {
    expect(pickEvictions([e('a', 10, 1), e('b', 10, 2)], 100)).toEqual([])
  })

  it('超预算：最旧优先，淘汰到落回预算内就停', () => {
    const entries = [e('new', 30, 300), e('old', 30, 100), e('mid', 30, 200)]
    // 合计 90、预算 50 ⇒ 要淘汰 40 ⇒ 最旧两条（30+30）
    expect(pickEvictions(entries, 50).map((x) => x.fileId)).toEqual(['old', 'mid'])
  })

  it('这次要写进去的字节也算进来（保证写完之后不越界）', () => {
    expect(pickEvictions([e('a', 30, 1)], 50, 30).map((x) => x.fileId)).toEqual(['a'])
    expect(pickEvictions([e('a', 20, 1)], 50, 30)).toEqual([])
  })

  it('不改动入参顺序', () => {
    const entries = [e('new', 30, 300), e('old', 30, 100)]
    pickEvictions(entries, 10)
    expect(entries.map((x) => x.fileId)).toEqual(['new', 'old'])
  })
})

describe('writeCachedPdf 的淘汰', () => {
  it('超预算时先删最旧的文件、并从账本里去掉它', () => {
    const unlinked: string[] = []
    taro.getFileSystemManager.mockReturnValue({
      writeFile: ({ success }: { success: () => void }) => success(),
      unlink: ({ filePath }: { filePath: string }) => unlinked.push(filePath),
    })
    taro.getStorageSync.mockImplementation((k: string) =>
      k === 'score-pdf-cache-index'
        ? [{ fileId: 'old', tag: 't', size: PDF_CACHE_BUDGET_BYTES, at: 1 }]
        : ''
    )
    writeCachedPdf('new', 'tag', new ArrayBuffer(4))
    expect(unlinked).toEqual(['/udp/score-old.pdf'])
    const indexCall = taro.setStorageSync.mock.calls.find((c) => c[0] === 'score-pdf-cache-index')
    expect(indexCall?.[1]).toEqual([{ fileId: 'new', tag: 'tag', size: 4, at: expect.any(Number) }])
  })
})

describe('cachedPdfPath', () => {
  it('fileId 为空 → null', () => {
    expect(cachedPdfPath('')).toBeNull()
  })

  it('有指纹 → 本地路径（供「原生打开」直接复用）', () => {
    taro.getStorageSync.mockReturnValue({ tag: 'tag' })
    expect(cachedPdfPath('abc')).toBe('/udp/score-abc.pdf')
  })

  it('无记录 / 记录里没有指纹 → null', () => {
    taro.getStorageSync.mockReturnValue('')
    expect(cachedPdfPath('abc')).toBeNull()
    taro.getStorageSync.mockReturnValue({})
    expect(cachedPdfPath('abc')).toBeNull()
  })
})
