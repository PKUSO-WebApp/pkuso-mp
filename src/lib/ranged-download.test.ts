import { describe, expect, it } from 'vitest'
import {
  CHUNK_BYTES,
  downloadInChunks,
  type RangeResponse,
  type RangedDeps,
  type RangedFs,
} from './ranged-download'

/** 内存文件系统：值是 Uint8Array（拼装正确性靠逐字节比对） */
function fakeFs(seed: Record<string, Uint8Array> = {}) {
  const files = new Map<string, Uint8Array>(Object.entries(seed))
  const fs: RangedFs = {
    size: async (p) => files.get(p)?.byteLength ?? 0,
    read: async (p) => {
      const f = files.get(p)
      if (!f) throw new Error(`no file ${p}`)
      return f.slice().buffer
    },
    write: async (p, d) => {
      files.set(p, new Uint8Array(d.slice(0)))
    },
    append: async (p, d) => {
      const prev = files.get(p) ?? new Uint8Array(0)
      const next = new Uint8Array(prev.byteLength + d.byteLength)
      next.set(prev, 0)
      next.set(new Uint8Array(d), prev.byteLength)
      files.set(p, next)
    },
    copy: async (src, dest) => {
      const f = files.get(src)
      if (!f) throw new Error(`no file ${src}`)
      files.set(dest, f.slice())
    },
    remove: async (p) => {
      files.delete(p)
    },
  }
  return { fs, files }
}

/** 远端：一段内容 + 一个「临时文件」区（fetchRange 把请求的区间放进 temp 文件） */
function harness(total: number, opts: { ignoreRange?: boolean } = {}) {
  let remote = new Uint8Array(total)
  for (let i = 0; i < total; i += 1) remote[i] = i % 251
  const { fs, files } = fakeFs()
  const calls: string[] = []
  let failNext = 0

  const fetchRange = async (url: string, range: string): Promise<RangeResponse> => {
    calls.push(`${url}|${range}`)
    if (failNext > 0) {
      failNext -= 1
      throw new Error('downloadFile:fail errcode:-101 ERR_CONNECTION_RESET')
    }
    const tmp = `${url}#tmp${calls.length}`
    if (opts.ignoreRange) {
      files.set(tmp, remote.slice())
      return { statusCode: 200, tempFilePath: tmp }
    }
    const m = /^bytes=(\d+)-(\d+)$/.exec(range)
    if (!m) throw new Error(`bad range ${range}`)
    const start = Number(m[1])
    const end = Number(m[2])
    files.set(tmp, remote.slice(start, end + 1))
    return { statusCode: 206, tempFilePath: tmp }
  }

  const deps: RangedDeps = { fs, fetchRange, sleep: async () => {} }
  return {
    deps,
    files,
    calls,
    remote,
    /** 让接下来 n 次请求在网络层失败 */
    failNext: (n: number) => {
      failNext = n
    },
    /** 把远端截短（模拟「库里记的长度比真实文件大」）。⚠️ 必须改闭包里的那份 */
    truncate: (n: number) => {
      remote = remote.slice(0, n)
    },
    setStatus: (code: number) => {
      deps.fetchRange = async (url, range) => {
        calls.push(`${url}|${range}`)
        return { statusCode: code, tempFilePath: 'x' }
      }
    },
  }
}

const DEST = '/usr/a.pdf'

/**
 * 顺序敏感的摘要：`toEqual` 逐字节比 4MB 数组会慢到超时，而只求和又抓不到「分片接反了」。
 * 滚动哈希同时满足「快」与「顺序敏感」。
 */
function digest(a: Uint8Array | undefined): string {
  if (!a) return 'missing'
  let h = 0
  for (let i = 0; i < a.byteLength; i += 1) h = (h * 31 + a[i]) >>> 0
  return `${a.byteLength}:${h}`
}

describe('downloadInChunks', () => {
  it('多片按序拼装，内容与远端**逐字节一致**', async () => {
    const total = CHUNK_BYTES * 2 + 1000
    const t = harness(total)
    await downloadInChunks({ urls: ['u1'], dest: DEST, totalBytes: total }, t.deps)
    expect(t.calls).toEqual([
      `u1|bytes=0-${CHUNK_BYTES - 1}`,
      `u1|bytes=${CHUNK_BYTES}-${CHUNK_BYTES * 2 - 1}`,
      `u1|bytes=${CHUNK_BYTES * 2}-${total - 1}`,
    ])
    expect(digest(t.files.get(DEST))).toBe(digest(t.remote))
  })

  it('⚠️ 断点续传：目标文件已有一部分 ⇒ 从**磁盘上的实际长度**接着要', async () => {
    // 内存记账与磁盘状态不一致时，只有"以磁盘为准"才能自愈
    const total = CHUNK_BYTES + 500
    const t = harness(total)
    t.files.set(DEST, t.remote.slice(0, 1500))
    await downloadInChunks({ urls: ['u1'], dest: DEST, totalBytes: total }, t.deps)
    expect(t.calls[0]).toBe(`u1|bytes=1500-${total - 1}`)
    expect(digest(t.files.get(DEST))).toBe(digest(t.remote))
  })

  it('某片网络失败：换候选 / 退避后重试，最终仍然拼对', async () => {
    const total = 1000
    const t = harness(total)
    t.failNext(1)
    await downloadInChunks({ urls: ['proxy', 'direct'], dest: DEST, totalBytes: total }, t.deps)
    expect(t.calls).toEqual(['proxy|bytes=0-999', 'direct|bytes=0-999'])
    expect(digest(t.files.get(DEST))).toBe(digest(t.remote))
  })

  it('服务端忽略 Range（200）：整份复制过去，且只求一次', async () => {
    const total = CHUNK_BYTES * 3
    const t = harness(total, { ignoreRange: true })
    await downloadInChunks({ urls: ['u1'], dest: DEST, totalBytes: total }, t.deps)
    expect(t.calls).toHaveLength(1)
    expect(digest(t.files.get(DEST))).toBe(digest(t.remote))
  })

  it('⚠️ 空分片立刻报错（否则 while 永不推进 = 死循环）', async () => {
    const t = harness(1000)
    t.deps.fetchRange = async (url, range) => {
      t.calls.push(`${url}|${range}`)
      t.files.set('empty', new Uint8Array(0))
      return { statusCode: 206, tempFilePath: 'empty' }
    }
    await expect(
      downloadInChunks({ urls: ['u1'], dest: DEST, totalBytes: 1000 }, t.deps)
    ).rejects.toThrow('提前结束')
    expect(t.calls).toHaveLength(1)
  })

  it('⚠️ 记录的总长比真实文件大 ⇒ 提前结束：**连半成品一起删掉**再报错', async () => {
    // 这是这个护栏在现实里的形态：库里 `file_size`=1000 而对象只有 900 字节。
    // 第一次请求拿到 900，第二次请求 900-999 时服务端回了空的 206。
    // 半成品**必须删**：长度对不上就不是一份能用的文件，而留着它下次还会从这里续传、
    // 永远拼不出一份合法的（宁可让用户重下一次，也不能交出一份损坏的 PDF）
    const t = harness(1000)
    t.truncate(900)
    await expect(
      downloadInChunks({ urls: ['u1'], dest: DEST, totalBytes: 1000 }, t.deps)
    ).rejects.toThrow('提前结束')
    expect(t.files.has(DEST)).toBe(false)
  })

  it('网络层失败**不删半成品**（下次进来才能续传）', async () => {
    const t = harness(CHUNK_BYTES * 2)
    // 第一片成功、第二片彻底失败
    let n = 0
    const real = t.deps.fetchRange
    t.deps.fetchRange = async (url, range) => {
      n += 1
      if (n > 1) throw new Error('ERR_CONNECTION_RESET')
      return real(url, range)
    }
    await expect(
      downloadInChunks({ urls: ['u1'], dest: DEST, totalBytes: CHUNK_BYTES * 2 }, t.deps)
    ).rejects.toThrow('ERR_CONNECTION_RESET')
    expect(t.files.get(DEST)?.byteLength).toBe(CHUNK_BYTES)
  })

  it('⚠️ 服务端回得比要的多 ⇒ 收尾校验拦下并删掉整份', async () => {
    // 打到 `finish` 那条护栏：循环是靠「长度达到 totalBytes」退出的，而这里服务端
    // 无视区间、每次都把整份塞回来（206 但内容超长）。不校验就会把一份长度不对的
    // 文件当成功交出去 —— 那是「静默损坏」，比失败糟得多。
    const t = harness(1000)
    t.deps.fetchRange = async (url, range) => {
      t.calls.push(`${url}|${range}`)
      t.files.set('all', t.remote.slice())
      return { statusCode: 206, tempFilePath: 'all' }
    }
    await expect(
      downloadInChunks({ urls: ['u1'], dest: DEST, totalBytes: 500 }, t.deps)
    ).rejects.toThrow('分片长度不符')
    expect(t.files.has(DEST)).toBe(false)
  })

  it('4xx：服务端明确说不行，**不重试**', async () => {
    const t = harness(1000)
    t.setStatus(404)
    await expect(
      downloadInChunks({ urls: ['u1'], dest: DEST, totalBytes: 1000 }, t.deps)
    ).rejects.toThrow('HTTP 404')
    expect(t.calls).toHaveLength(1)
  })

  it('5xx（反代上游失败会回 502）：算可重试', async () => {
    const t = harness(1000)
    let n = 0
    t.deps.fetchRange = async (url, range) => {
      t.calls.push(`${url}|${range}`)
      n += 1
      if (n < 3) return { statusCode: 502, tempFilePath: 'x' }
      t.files.set('ok', t.remote.slice())
      return { statusCode: 206, tempFilePath: 'ok' }
    }
    await downloadInChunks({ urls: ['u1'], dest: DEST, totalBytes: 1000 }, t.deps)
    expect(t.calls).toHaveLength(3)
    expect(digest(t.files.get(DEST))).toBe(digest(t.remote))
  })

  it('没有可用地址 / 缺总长：直接报错，不发请求', async () => {
    const t = harness(1000)
    await expect(
      downloadInChunks({ urls: [], dest: DEST, totalBytes: 1000 }, t.deps)
    ).rejects.toThrow('没有可用的下载地址')
    await expect(
      downloadInChunks({ urls: ['u1'], dest: DEST, totalBytes: 0 }, t.deps)
    ).rejects.toThrow('缺少文件总长')
    expect(t.calls).toEqual([])
  })

  it('小文件一片就完事', async () => {
    const t = harness(300)
    await downloadInChunks({ urls: ['u1'], dest: DEST, totalBytes: 300 }, t.deps)
    expect(t.calls).toEqual(['u1|bytes=0-299'])
  })
})
