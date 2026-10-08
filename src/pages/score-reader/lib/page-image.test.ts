import { describe, expect, it } from 'vitest'
import {
  loadPageImage,
  loadPageImageWithRetry,
  PAGE_IMAGE_RETRY_DELAYS_MS,
  type PageImageError,
} from './page-image'
import type { CanvasNode } from './types'

/**
 * 假画布节点：`createImage()` 每次返回一张「赋 src 就异步触发 onload / onerror」的假图片。
 * `payloads` 按调用次序取——`'ok'` 表示这次成功，其余值原样喂给 onerror。
 */
function fakeNode(payloads: Array<unknown | 'ok'>) {
  let call = 0
  return {
    createImage: () => {
      const payload = payloads[Math.min(call, payloads.length - 1)]
      call += 1
      const img = { width: 10, height: 20 } as Record<string, unknown>
      Object.defineProperty(img, 'src', {
        set() {
          queueMicrotask(() => {
            if (payload === 'ok') (img.onload as (() => void) | null)?.()
            else (img.onerror as ((e: unknown) => void) | null)?.(payload)
          })
        },
      })
      return img
    },
  } as unknown as CanvasNode
}

/**
 * 每个用例拿自己的一组 URL。**必须这样**：模块里那份「下载过的本地路径」记账
 * 是跨用例保留的，共用 URL 会让后面的用例悄悄命中前面用例写下的路径。
 */
let seq = 0
function freshUrls(): [string, string] {
  seq += 1
  return [`https://t${seq}-proxy/p1.jpg`, `https://t${seq}-direct/p1.jpg`]
}

/** 断言「必须失败」，并把错误按 PageImageError 取出来 */
const fail = (p: Promise<unknown>): Promise<PageImageError> =>
  p.then(
    () => {
      throw new Error('本该失败却成功了')
    },
    (e) => e as PageImageError
  )

/** 恒失败的下载桩：用例只想验图片层那轮时，用它把兜底那轮钉在失败上（也免得真去调 Taro） */
const downloadNever = async () => ({ statusCode: 500, tempFilePath: '' })

describe('loadPageImage 主路径（小程序图片层）', () => {
  it('第一条失败、第二条成功 ⇒ 正常返回，不当失败', async () => {
    const [proxy, direct] = freshUrls()
    const img = await loadPageImage(fakeNode([{ errMsg: 'proxy 502' }, 'ok']), [proxy, direct], {
      downloadFile: downloadNever,
    })
    expect(img.width).toBe(10)
  })

  it('图片层两条腿都失败 ⇒ 兜底只下第一条腿（成功就不试第二条）', async () => {
    const [proxy, direct] = freshUrls()
    const files: string[] = []
    const img = await loadPageImage(
      fakeNode([{ errMsg: 'proxy 502' }, { errMsg: 'direct 502' }, 'ok']),
      [proxy, direct],
      {
        downloadFile: async (url) => {
          files.push(url)
          return { statusCode: 200, tempFilePath: 'wxfile://tmp/p1.jpg' }
        },
      }
    )
    expect(img.width).toBe(10)
    expect(files).toEqual([proxy])
  })

  it('兜底第一条腿 HTTP 403 ⇒ 换第二条腿下，成功', async () => {
    const [proxy, direct] = freshUrls()
    const files: string[] = []
    const img = await loadPageImage(
      fakeNode([{ errMsg: 'x' }, { errMsg: 'x' }, 'ok']),
      [proxy, direct],
      {
        downloadFile: async (url) => {
          files.push(url)
          return url === proxy
            ? { statusCode: 403, tempFilePath: '' }
            : { statusCode: 200, tempFilePath: 'wxfile://tmp/p.jpg' }
        },
      }
    )
    expect(files).toEqual([proxy, direct])
    expect(img.width).toBe(10)
  })

  it('兜底下来的本地路径记在本会话里：同一 URL 第二次不再下载（重渲/翻回来走它）', async () => {
    const [proxy] = freshUrls()
    let downloads = 0
    const deps = {
      downloadFile: async () => {
        downloads += 1
        return { statusCode: 200, tempFilePath: `wxfile://tmp/once-${downloads}.jpg` }
      },
    }
    await loadPageImage(fakeNode([{ errMsg: 'x' }, 'ok']), [proxy], deps)
    expect(downloads).toBe(1)
    await loadPageImage(fakeNode([{ errMsg: 'x' }, 'ok']), [proxy], deps)
    expect(downloads).toBe(1)
  })
})

describe('loadPageImage 的失败信息（诊断用）', () => {
  it('两条路都失败：via 指最后那条路，trace 把两条路各自的失败原因都留下', async () => {
    const [proxy, direct] = freshUrls()
    const err = await fail(
      loadPageImage(
        fakeNode([{ errMsg: 'proxy 502' }, { errMsg: 'direct 502' }]),
        [proxy, direct],
        {
          downloadFile: async () => ({ statusCode: 403, tempFilePath: '' }),
        }
      )
    )
    expect(err.message).toBe('页图下载失败：HTTP 403')
    expect(err.via).toBe('file')
    expect(err.urlIndex).toBe(1)
    expect(err.trace).toContain('image#0 页图加载失败（proxy 502）')
    expect(err.trace).toContain('image#1 页图加载失败（direct 502）')
    expect(err.trace).toContain('file#0 页图下载失败：HTTP 403')
    expect(err.trace).toContain('file#1 页图下载失败：HTTP 403')
  })

  it('onerror 不带可用文案时不虚构：那一条在 trace 里就是光秃秃的「页图加载失败」', async () => {
    const [proxy] = freshUrls()
    const err = await fail(
      loadPageImage(fakeNode([undefined]), [proxy], { downloadFile: downloadNever })
    )
    expect(err.errMsg).toBeUndefined()
    expect(err.trace?.split(' | ')[0]).toBe('image#0 页图加载失败')
  })

  it('图片层坏了、兜底成功时不算失败（这正是 2026-10-08 那台 iOS 的路径）', async () => {
    const [proxy, direct] = freshUrls()
    const img = await loadPageImage(
      fakeNode([{ errMsg: '' }, { errMsg: '' }, 'ok']),
      [proxy, direct],
      {
        downloadFile: async () => ({ statusCode: 200, tempFilePath: 'wxfile://tmp/ok.jpg' }),
      }
    )
    expect(img.width).toBe(10)
  })
})

describe('loadPageImageWithRetry（失败退避重试）', () => {
  const noWait = () => Promise.resolve()
  const deps = { downloadFile: downloadNever }

  it('默认配置：首次 + 两次重试 = 3 次尝试，抛的是最后一次的错误', async () => {
    const err = await fail(
      loadPageImageWithRetry(
        fakeNode([{ errMsg: 'first' }, { errMsg: 'second' }, { errMsg: 'third' }]),
        [freshUrls()[0]],
        { sleep: noWait, deps }
      )
    )
    expect(PAGE_IMAGE_RETRY_DELAYS_MS).toEqual([500, 1000])
    expect(err.trace).toContain('（third）')
  })

  it('重试成功就返回，不浪费后面的尝试', async () => {
    const img = await loadPageImageWithRetry(
      fakeNode([{ errMsg: 'boom' }, 'ok']),
      [freshUrls()[0]],
      {
        sleep: noWait,
        deps,
      }
    )
    expect(img.width).toBe(10)
  })

  it('每次都按给定间隔退避（顺序与次数都要对）', async () => {
    const slept: number[] = []
    await fail(
      loadPageImageWithRetry(fakeNode([undefined]), [freshUrls()[0]], {
        sleep: (ms) => {
          slept.push(ms)
          return Promise.resolve()
        },
        deps,
      })
    )
    expect(slept).toEqual([500, 1000]) // 两次重试各等一拍，第三次失败后不再等
  })
})
