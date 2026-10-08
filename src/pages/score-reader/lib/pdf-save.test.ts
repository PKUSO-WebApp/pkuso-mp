import { describe, expect, it, vi } from 'vitest'
import { savedPdfPath, saveOriginalPdf, userDataRoot, type FsLike } from './pdf-save'

/** 内存版 FileSystemManager：只实现这个模块用到的三件事 */
function fakeFs(initial: string[] = []) {
  const files = new Set(initial)
  const calls: string[] = []
  const fs: FsLike = {
    access({ path, success, fail }) {
      calls.push(`access:${path}`)
      if (files.has(path)) success()
      else fail()
    },
    saveFile({ tempFilePath, filePath, success, fail }) {
      calls.push(`save:${tempFilePath}->${filePath}`)
      // 目标已存在时按微信的语义报错（由 saveTo 的 unlink-重试路径兜住）
      if (files.has(filePath)) {
        fail({ errMsg: 'file already exists' })
        return
      }
      files.add(filePath)
      success()
    },
    unlink({ filePath, success, fail }) {
      calls.push(`unlink:${filePath}`)
      files.delete(filePath)
      if (success) success()
      else fail?.()
    },
  }
  return { fs, files, calls }
}

const deps = (over: Partial<Parameters<typeof saveOriginalPdf>[1]> = {}) => {
  const download = vi.fn(async () => ({ statusCode: 200, tempFilePath: '/tmp/x.pdf' }))
  const { fs, files, calls } = fakeFs()
  return {
    download,
    fs,
    files,
    calls,
    deps: { root: '/usr', fs, download, ...over } as Parameters<typeof saveOriginalPdf>[1],
  }
}

describe('savedPdfPath', () => {
  it('按册固定（同名 = 同一册），路径在给定的根目录下', () => {
    expect(savedPdfPath('/usr', 'file-1')).toBe('/usr/pkuso-score-file-1.pdf')
    expect(savedPdfPath('/usr', 'file-1')).toBe(savedPdfPath('/usr', 'file-1'))
  })
})

describe('saveOriginalPdf', () => {
  it('本地没有就下载并落盘', async () => {
    const t = deps()
    const res = await saveOriginalPdf({ fileId: 'f1', url: 'https://x/a.pdf' }, t.deps)
    expect(res).toEqual({ path: '/usr/pkuso-score-f1.pdf', reused: false })
    expect(t.files.has('/usr/pkuso-score-f1.pdf')).toBe(true)
    expect(t.download).toHaveBeenCalledWith('https://x/a.pdf')
  })

  it('本地已有就**不再下载**（判据是文件在不在，不是内存记账）', async () => {
    const { fs, files, calls } = fakeFs(['/usr/pkuso-score-f1.pdf'])
    const download = vi.fn()
    const res = await saveOriginalPdf(
      { fileId: 'f1', url: 'https://x/a.pdf' },
      { root: '/usr', fs, download }
    )
    expect(res.reused).toBe(true)
    expect(download).not.toHaveBeenCalled()
    expect(files.has('/usr/pkuso-score-f1.pdf')).toBe(true)
    expect(calls).toEqual(['access:/usr/pkuso-score-f1.pdf'])
  })

  it('非 200 直接失败，不留半截文件', async () => {
    const download = vi.fn(async () => ({ statusCode: 403, tempFilePath: '/tmp/x.pdf' }))
    const { fs, files } = fakeFs()
    await expect(
      saveOriginalPdf({ fileId: 'f1', url: 'u' }, { root: '/usr', fs, download })
    ).rejects.toThrow('HTTP 403')
    expect(files.size).toBe(0)
  })

  it('目标已存在但 access 没看见（竞态）：删掉再存一次', async () => {
    const { fs, files, calls } = fakeFs(['/usr/pkuso-score-f1.pdf'])
    // 让 access 报「不存在」，模拟竞态下的一瞬
    const raceFs: FsLike = { ...fs, access: ({ fail }) => fail() }
    const download = vi.fn(async () => ({ statusCode: 200, tempFilePath: '/tmp/x.pdf' }))
    const res = await saveOriginalPdf(
      { fileId: 'f1', url: 'u' },
      { root: '/usr', fs: raceFs, download }
    )
    expect(res.reused).toBe(false)
    expect(files.has('/usr/pkuso-score-f1.pdf')).toBe(true)
    expect(calls.some((c) => c.startsWith('unlink:'))).toBe(true)
  })

  it('下载本身失败：错误往外抛，不静默成功', async () => {
    const download = vi.fn(async () => {
      throw new Error('downloadFile:fail timeout')
    })
    const { fs } = fakeFs()
    await expect(
      saveOriginalPdf({ fileId: 'f1', url: 'u' }, { root: '/usr', fs, download })
    ).rejects.toThrow('timeout')
  })

  it('拿不到 USER_DATA_PATH / FileSystemManager：报错，不假装存好了', async () => {
    const t = deps()
    await expect(
      saveOriginalPdf({ fileId: 'f1', url: 'u' }, { ...t.deps, root: null })
    ).rejects.toThrow('USER_DATA_PATH')
    await expect(
      saveOriginalPdf({ fileId: 'f1', url: 'u' }, { ...t.deps, fs: null })
    ).rejects.toThrow('FileSystemManager')
  })
})

describe('userDataRoot', () => {
  it('从 wx.env 取根目录；没有 wx（单测/SSR）时给 null 而不是抛', () => {
    const g = globalThis as { wx?: unknown }
    const saved = g.wx
    try {
      g.wx = { env: { USER_DATA_PATH: '/usr' } }
      expect(userDataRoot()).toBe('/usr')
      g.wx = undefined
      expect(userDataRoot()).toBeNull()
    } finally {
      g.wx = saved
    }
  })
})
