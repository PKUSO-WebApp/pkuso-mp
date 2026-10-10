import { describe, expect, it, vi } from 'vitest'
import {
  displayPdfName,
  ensureSavedPdf,
  PDF_RETRY_DELAYS_MS,
  legacyPdfPath,
  MAX_NAME_CHARS,
  savedPdfDir,
  userDataRoot,
  type FsLike,
} from './pdf-save'

/** 内存版 FileSystemManager：只实现这个模块用到的五件事 */
function fakeFs(initial: string[] = []) {
  const files = new Set(initial)
  const dirs = new Set<string>()
  const calls: string[] = []
  const fs: FsLike = {
    access({ path, success, fail }) {
      calls.push(`access:${path}`)
      if (files.has(path)) success()
      else fail()
    },
    saveFile({ tempFilePath, filePath, success, fail }) {
      calls.push(`save:${tempFilePath}->${filePath}`)
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
    mkdir({ dirPath, success }) {
      calls.push(`mkdir:${dirPath}`)
      dirs.add(dirPath)
      success?.()
    },
    readdir({ dirPath, success, fail }) {
      calls.push(`readdir:${dirPath}`)
      const prefix = `${dirPath}/`
      const out = [...files].filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length))
      if (out.length > 0 || dirs.has(dirPath)) success({ files: out })
      else fail?.()
    },
  }
  return { fs, files, dirs, calls }
}

type EnsureOpts = Parameters<typeof ensureSavedPdf>[0]
type EnsureDeps = Parameters<typeof ensureSavedPdf>[1]

const opts = (over: Partial<EnsureOpts> = {}): EnsureOpts => ({
  fileId: 'f1',
  url: 'https://x/a.pdf',
  title: '肖五',
  section: '第一小提琴',
  fileName: '小提琴1.pdf',
  ...over,
})

function deps(files: string[] = [], over: Partial<EnsureDeps> = {}) {
  const download = vi.fn(async () => ({ statusCode: 200, tempFilePath: '/tmp/x.pdf' }))
  const { fs, files: store, dirs, calls } = fakeFs(files)
  return {
    download,
    files: store,
    dirs,
    calls,
    deps: { root: '/usr', fs, download, ...over } as EnsureDeps,
  }
}

describe('displayPdfName', () => {
  it('三件齐全：{曲子}_{声部}_{文件名}.pdf', () => {
    expect(displayPdfName({ title: '肖五', section: '第一小提琴', fileName: '小提琴1.pdf' })).toBe(
      '肖五_第一小提琴_小提琴1.pdf'
    )
  })

  it('⚠️ file_name 库里自带 .pdf：剥掉再拼，绝不出现 .pdf.pdf', () => {
    const name = displayPdfName({ title: '肖五', section: '圆号', fileName: 'F调圆号3.pdf' })
    expect(name).toBe('肖五_圆号_F调圆号3.pdf')
    expect(name.match(/\.pdf/g)).toHaveLength(1)
  })

  it('大写后缀同样剥掉', () => {
    expect(displayPdfName({ fileName: '长号2.PDF' })).toBe('长号2.pdf')
  })

  it('缺参数逐级省略（旧入口拿不到曲名/声部）', () => {
    expect(displayPdfName({ section: '弦乐', fileName: '小提琴1.pdf' })).toBe('弦乐_小提琴1.pdf')
    expect(displayPdfName({ fileName: '小提琴1.pdf' })).toBe('小提琴1.pdf')
  })

  it('名字里的路径分隔符与保留字符被替掉（否则会写出目录外）', () => {
    const name = displayPdfName({
      title: 'a/b\\c:d*e?f"g<h>i|j',
      section: '弦乐',
      fileName: 'x.pdf',
    })
    expect(name).toBe('a b c d e f g h i j_弦乐_x.pdf')
    expect(name).not.toMatch(/[\\/:*?"<>|]/)
  })

  it('空白压成一个空格、首尾去掉', () => {
    expect(displayPdfName({ title: '  红 旗   颂 ', fileName: ' a.pdf ' })).toBe('红 旗 颂_a.pdf')
  })

  it('全空时给一个兜底名，而不是 ".pdf"', () => {
    expect(displayPdfName({ fileName: '' })).toBe('score.pdf')
    expect(displayPdfName({ fileName: '.pdf' })).toBe('score.pdf')
  })

  it('超长截断（不含 .pdf 后缀的那部分）', () => {
    const name = displayPdfName({ title: 'x'.repeat(500), fileName: 'a.pdf' })
    expect(name).toBe(`${'x'.repeat(MAX_NAME_CHARS)}.pdf`)
  })
})

describe('ensureSavedPdf', () => {
  it('本地没有就下载并落盘，路径带交付名', async () => {
    const t = deps()
    const res = await ensureSavedPdf(opts(), t.deps)
    expect(res).toEqual({
      path: '/usr/pkuso-score/f1/肖五_第一小提琴_小提琴1.pdf',
      name: '肖五_第一小提琴_小提琴1.pdf',
      reused: false,
    })
    expect(t.files.has(res.path)).toBe(true)
    expect(t.download).toHaveBeenCalledWith('https://x/a.pdf')
    expect(t.calls).toContain('mkdir:/usr/pkuso-score/f1')
  })

  it('本地已有同名的就**不再下载**（判据是文件在不在，不是内存记账）', async () => {
    const path = '/usr/pkuso-score/f1/肖五_第一小提琴_小提琴1.pdf'
    const t = deps([path])
    const res = await ensureSavedPdf(opts(), t.deps)
    expect(res.reused).toBe(true)
    expect(res.path).toBe(path)
    expect(t.download).not.toHaveBeenCalled()
  })

  it('名字对不上但目录里有别的 pdf（曲名改过 / 缺参数）：复用旧的，不重下也不改名', async () => {
    const old = '/usr/pkuso-score/f1/红旗颂_弦乐_小提琴1.pdf'
    const t = deps([old])
    const res = await ensureSavedPdf(opts(), t.deps)
    expect(res).toEqual({ path: old, name: '红旗颂_弦乐_小提琴1.pdf', reused: true })
    expect(t.download).not.toHaveBeenCalled()
    expect(t.calls.some((c) => c.startsWith('save:'))).toBe(false)
  })

  it('目录里有非 pdf 的文件时不误判（readdir 结果是过滤过的）', async () => {
    const t = deps(['/usr/pkuso-score/f1/notes.txt'])
    const res = await ensureSavedPdf(opts(), t.deps)
    expect(res.reused).toBe(false)
    expect(t.download).toHaveBeenCalled()
  })

  it('非 200 直接失败，不留半截文件', async () => {
    const t = deps([], {
      download: vi.fn(async () => ({ statusCode: 403, tempFilePath: '/tmp/x.pdf' })),
    } as Partial<EnsureDeps>)
    await expect(ensureSavedPdf(opts(), t.deps)).rejects.toThrow('HTTP 403')
    expect(t.files.size).toBe(0)
  })

  it('目标已存在但 access 没看见（竞态）：删掉再存一次', async () => {
    const path = '/usr/pkuso-score/f1/肖五_第一小提琴_小提琴1.pdf'
    const base = fakeFs([path])
    // readdir 也「看不见」它，模拟竞态下的一瞬
    const raceFs: FsLike = {
      ...base.fs,
      access: ({ fail }) => fail(),
      readdir: ({ fail }) => fail?.(),
    }
    const res = await ensureSavedPdf(opts(), { root: '/usr', fs: raceFs, download: vi.fn(async () => ({ statusCode: 200, tempFilePath: '/tmp/x.pdf' })) })
    expect(res.reused).toBe(false)
    expect(base.files.has(path)).toBe(true)
    expect(base.calls.some((c) => c.startsWith('unlink:'))).toBe(true)
  })

  it('成功落盘后清掉迁移前的老路径（别白占 200MB 配额）', async () => {
    const legacy = legacyPdfPath('/usr', 'f1')
    const t = deps([legacy])
    await ensureSavedPdf(opts(), t.deps)
    expect(t.files.has(legacy)).toBe(false)
    expect(t.calls).toContain(`unlink:${legacy}`)
  })

  it('下载本身失败：错误往外抛，不静默成功', async () => {
    const t = deps([], {
      download: vi.fn(async () => {
        throw new Error('downloadFile:fail timeout')
      }),
    } as Partial<EnsureDeps>)
    await expect(ensureSavedPdf(opts(), t.deps)).rejects.toThrow('timeout')
  })

  it('拿不到 USER_DATA_PATH / FileSystemManager：报错，不假装存好了', async () => {
    const t = deps()
    await expect(ensureSavedPdf(opts(), { ...t.deps, root: null })).rejects.toThrow(
      'USER_DATA_PATH'
    )
    await expect(ensureSavedPdf(opts(), { ...t.deps, fs: null })).rejects.toThrow(
      'FileSystemManager'
    )
  })
})

describe('路径规则', () => {
  it('目录按 fileId（幂等判据），与显示名解耦', () => {
    expect(savedPdfDir('/usr', 'file-1')).toBe('/usr/pkuso-score/file-1')
  })

  it('老路径仍是根下的 pkuso-score-<id>.pdf（只为清掉它）', () => {
    expect(legacyPdfPath('/usr', 'file-1')).toBe('/usr/pkuso-score-file-1.pdf')
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

describe('PDF 下载的退避重试', () => {
  const base = () => {
    const download = vi.fn()
    const { fs } = fakeFs()
    return { download, deps: { root: '/usr', fs, download, sleep: async () => {} } as EnsureDeps }
  }

  it('网络失败一次后成功：重试一次，最终落盘成功', async () => {
    const t = base()
    t.download
      .mockRejectedValueOnce(new Error('downloadFile:fail errcode:-101 ERR_CONNECTION_RESET'))
      .mockResolvedValueOnce({ statusCode: 200, tempFilePath: '/tmp/x.pdf' })
    const res = await ensureSavedPdf(opts(), t.deps)
    expect(res.reused).toBe(false)
    expect(t.download).toHaveBeenCalledTimes(2)
  })

  it('一直失败：试满次数后抛出**最后一次**的错误（而不是第一次的）', async () => {
    const t = base()
    t.download
      .mockRejectedValueOnce(new Error('第一次'))
      .mockRejectedValueOnce(new Error('第二次'))
      .mockRejectedValueOnce(new Error('第三次'))
    await expect(ensureSavedPdf(opts(), t.deps)).rejects.toThrow('第三次')
    expect(t.download).toHaveBeenCalledTimes(1 + PDF_RETRY_DELAYS_MS.length)
  })

  it('⚠️ 非 200 是服务端明确拒绝 —— **不重试**，一次就失败', async () => {
    // 「重试一切失败」看似更稳，实则把 403/404 也重试三遍：白等两秒、白占额度
    const t = base()
    t.download.mockResolvedValue({ statusCode: 403, tempFilePath: '/tmp/x.pdf' })
    await expect(ensureSavedPdf(opts(), t.deps)).rejects.toThrow('HTTP 403')
    expect(t.download).toHaveBeenCalledTimes(1)
  })

  it('一次就成：不重试', async () => {
    const t = base()
    t.download.mockResolvedValue({ statusCode: 200, tempFilePath: '/tmp/x.pdf' })
    await ensureSavedPdf(opts(), t.deps)
    expect(t.download).toHaveBeenCalledTimes(1)
  })
})
