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

/**
 * 内存版 FileSystemManager。
 *
 * ⚠️ 它**必须像真机一样要求「父目录先存在」**：曾经这里只往集合里加路径、从不检查父目录，
 * 于是「分片那条路忘了 mkdir」这个 bug 一路测到了线上（dev.184 的 iOS 上报：
 * `writeFile:fail no such file or directory`）。**夹具比现实宽松，现实里的约束就测不到。**
 */
function fakeFs(initial: string[] = []) {
  const files = new Map<string, Uint8Array>()
  const dirs = new Set<string>()
  const calls: string[] = []
  const parentOf = (p: string) => p.slice(0, p.lastIndexOf('/'))
  // 预置的文件意味着它的目录也在（否则连"复用"那批用例都建不起来）
  for (const f of initial) {
    files.set(f, new Uint8Array(1))
    dirs.add(parentOf(f))
  }
  const noDir = (p: string) => !dirs.has(parentOf(p)) && parentOf(p) !== ''
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
      if (noDir(filePath)) {
        fail({ errMsg: `no such file or directory, open '${filePath}'` })
        return
      }
      files.set(filePath, new Uint8Array(1))
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
      const out = [...files.keys()].filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length))
      if (out.length > 0 || dirs.has(dirPath)) success({ files: out })
      else fail?.()
    },
    // —— 以下五个只被分片下载用。同样要求父目录存在 ——
    stat({ path, success, fail }) {
      const f = files.get(path)
      if (f) success({ stats: { size: f.byteLength } })
      else fail?.()
    },
    readFile({ filePath, success, fail }) {
      const f = files.get(filePath)
      if (f) success({ data: f.slice().buffer })
      else fail?.({ errMsg: `no such file ${filePath}` })
    },
    writeFile({ filePath, data, success, fail }) {
      calls.push(`write:${filePath}`)
      if (noDir(filePath)) {
        fail?.({ errMsg: `no such file or directory, open '${filePath}'` })
        return
      }
      files.set(filePath, new Uint8Array(data.slice(0)))
      success?.()
    },
    appendFile({ filePath, data, success, fail }) {
      calls.push(`append:${filePath}`)
      const prev = files.get(filePath)
      if (!prev) {
        fail?.({ errMsg: `no such file ${filePath}` })
        return
      }
      const next = new Uint8Array(prev.byteLength + data.byteLength)
      next.set(prev, 0)
      next.set(new Uint8Array(data), prev.byteLength)
      files.set(filePath, next)
      success?.()
    },
    copyFile({ srcPath, destPath, success, fail }) {
      calls.push(`copy:${srcPath}->${destPath}`)
      const src = files.get(srcPath)
      if (!src || noDir(destPath)) {
        fail?.({ errMsg: 'no such file or directory' })
        return
      }
      files.set(destPath, src.slice())
      success?.()
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

  // ⚠️ 用**分片**那条路来验「先删」：单次下载那条 `saveTo` 自己也会先删目标文件，
  // 于是「删没删」这个断言在那边永远成立、验不出东西（本仓栽过这类「夹具空转」）。
  // 分片那条路不经过 saveTo，删它只可能来自 force 这一处。
  it('⚠️ force：本地已有也**必须重下**，且旧文件要在写入**之前**删掉', async () => {
    const stale = '/usr/pkuso-score/f1/肖五_第一小提琴_小提琴1.pdf'
    const t = deps([stale])
    t.download.mockImplementation(async () => {
      t.files.set('/tmp/chunk', new Uint8Array(4).fill(7))
      return { statusCode: 206, tempFilePath: '/tmp/chunk' }
    })

    const res = await ensureSavedPdf(opts({ force: true, expectedBytes: 4 }), t.deps)

    expect(res.reused).toBe(false)
    expect(t.download).toHaveBeenCalled()
    const un = t.calls.indexOf(`unlink:${stale}`)
    const firstWrite = t.calls.findIndex((c) => c.startsWith('write:') || c.startsWith('copy:'))
    expect(un).toBeGreaterThanOrEqual(0)
    // 分片是从**已有文件的长度**续传的：不先删就会拿旧长度当起点，拼出一份坏文件
    expect(un).toBeLessThan(firstWrite)
    expect(t.files.get(res.path)?.byteLength).toBe(4)
  })

  it('force：目录里那些**别的名字**的旧文件也清掉（不然它们白占 200MB 配额）', async () => {
    const other = '/usr/pkuso-score/f1/旧曲名_弦乐_小提琴1.pdf'
    const t = deps([other])
    await ensureSavedPdf(opts({ force: true }), t.deps)

    expect(t.calls).toContain(`unlink:${other}`)
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

describe('分片下载那条路（给了 expectedBytes）', () => {
  it('⚠️ 先建目录、再写分片 —— 少这一步真机就报 no such file or directory', async () => {
    // 线上实证（dev.184，iOS）：分片那条路**没有建目标目录**（mkdirp 只写在单次下载那条路上），
    // 于是 writeFile 直接报 `no such file or directory, open 'wxfile://usr/pkuso-score/<id>/…'`。
    // 而当时的夹具从不要求父目录存在，所以这个 bug 一路测到了线上。
    const t = deps()
    const bytes = new Uint8Array(4).fill(7)
    t.download.mockImplementation(async () => {
      t.files.set('/tmp/chunk', bytes)
      return { statusCode: 206, tempFilePath: '/tmp/chunk' }
    })
    const res = await ensureSavedPdf(opts({ expectedBytes: 4 }), t.deps)
    expect(res.reused).toBe(false)
    expect(t.files.get(res.path)?.byteLength).toBe(4)
    const mk = t.calls.indexOf('mkdir:/usr/pkuso-score/f1')
    expect(mk).toBeGreaterThanOrEqual(0)
    expect(mk).toBeLessThan(t.calls.indexOf(`write:${res.path}`))
  })

  it('分片请求带 Range 头；没给 expectedBytes 时退回单次下载', async () => {
    const t = deps()
    const bytes = new Uint8Array(4).fill(7)
    t.download.mockImplementation(async () => {
      t.files.set('/tmp/chunk', bytes)
      return { statusCode: 206, tempFilePath: '/tmp/chunk' }
    })
    await ensureSavedPdf(opts({ expectedBytes: 4 }), t.deps)
    expect(t.download).toHaveBeenCalledWith(expect.any(String), { Range: 'bytes=0-3' })

    const t2 = deps()
    t2.download.mockResolvedValue({ statusCode: 200, tempFilePath: '/tmp/x.pdf' })
    await ensureSavedPdf(opts(), t2.deps)
    expect(t2.download).toHaveBeenCalledWith('https://x/a.pdf') // 不带 header 的那个分支
  })
})
