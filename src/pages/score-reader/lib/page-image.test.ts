import { beforeEach, describe, expect, it } from 'vitest'
import {
  isImageLayerBroken,
  loadPageImage,
  loadPageImageWithRetry,
  prefetchPageImage,
  resetPageImageStrategy,
  PAGE_IMAGE_RETRY_DELAYS_MS,
  type PageImageError,
} from './page-image'
import type { CanvasNode } from './types'

// 「图片层还能不能用」的判定是模块级、跨用例保留的：每个用例都从「还没判过」开始
beforeEach(() => resetPageImageStrategy())

/**
 * 假画布节点：`createImage()` 每次返回一张「赋 src 就异步触发 onload / onerror」的假图片。
 * `payloads` 按调用次序取——`'ok'` 表示这次成功，其余值原样喂给 onerror。
 * `srcs` 记下每次被赋的 src：**断言「走的是哪条路」靠它**（两条路都调 createImage，
 * 区别只在 src 是远端 URL 还是本地路径）。
 */
function fakeNode(payloads: Array<unknown | 'ok'>): CanvasNode & { srcs: string[] } {
  let call = 0
  const srcs: string[] = []
  const node = {
    createImage: () => {
      const payload = payloads[Math.min(call, payloads.length - 1)]
      call += 1
      const img = { width: 10, height: 20 } as Record<string, unknown>
      Object.defineProperty(img, 'src', {
        set(v: string) {
          srcs.push(v)
          queueMicrotask(() => {
            if (payload === 'ok') (img.onload as (() => void) | null)?.()
            else (img.onerror as ((e: unknown) => void) | null)?.(payload)
          })
        },
      })
      return img
    },
    srcs,
  }
  return node as unknown as CanvasNode & { srcs: string[] }
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
      key: proxy,
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
        key: proxy,
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
        key: proxy,
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
    await loadPageImage(fakeNode([{ errMsg: 'x' }, 'ok']), [proxy], { key: proxy, ...deps })
    expect(downloads).toBe(1)
    // 第二次：第 0 档命中本地记账（**不走图片层**——node 只给了一个 'ok'，要是先去图片层
    // 就画到远端 URL 上了），直接画本地那份
    const second = fakeNode(['ok'])
    await loadPageImage(second, [proxy], { key: proxy, ...deps })
    expect(downloads).toBe(1)
    expect(second.srcs).toEqual(['wxfile://tmp/once-1.jpg'])
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
          key: proxy,
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
      loadPageImage(fakeNode([undefined]), [proxy], { key: proxy, downloadFile: downloadNever })
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
        key: proxy,
        downloadFile: async () => ({ statusCode: 200, tempFilePath: 'wxfile://tmp/ok.jpg' }),
      }
    )
    expect(img.width).toBe(10)
  })
})

describe('取图策略的判定（判一次、本会话记住）', () => {
  const okDownload = async () => ({ statusCode: 200, tempFilePath: 'wxfile://tmp/once.jpg' })

  it('图片层失败 + 兜底成功 ⇒ 判定图片层坏了；下一次取图不再去撞远端', async () => {
    const [proxy] = freshUrls()
    const deps = { downloadFile: okDownload }
    const first = fakeNode([{ errMsg: 'boom' }, 'ok'])
    await loadPageImage(first, [proxy], { key: proxy, ...deps })
    expect(first.srcs).toEqual([proxy, 'wxfile://tmp/once.jpg'])
    expect(isImageLayerBroken()).toBe(true)

    const second = fakeNode(['ok'])
    await loadPageImage(second, [proxy], { key: proxy, ...deps })
    expect(second.srcs).toEqual(['wxfile://tmp/once.jpg']) // 只画本地那份，没试远端
  })

  it('两条路都失败 ⇒ 不下结论（可能只是网络），下一次仍然先试图片层', async () => {
    const [proxy] = freshUrls()
    await fail(
      loadPageImage(fakeNode([{ errMsg: 'boom' }]), [proxy], { key: proxy, downloadFile: downloadNever })
    )
    expect(isImageLayerBroken()).toBe(false)

    const next = fakeNode(['ok'])
    await loadPageImage(next, [proxy], { key: proxy, downloadFile: downloadNever })
    expect(next.srcs).toEqual([proxy])
  })

  it('复位之后重新判：换册 / 点「重试」不该永远锁在兜底那条路上', async () => {
    const [proxy] = freshUrls()
    const deps = { downloadFile: okDownload }
    await loadPageImage(fakeNode([{ errMsg: 'boom' }, 'ok']), [proxy], { key: proxy, ...deps })
    expect(isImageLayerBroken()).toBe(true)

    resetPageImageStrategy()
    // ⚠️ 必须换一条 URL：上面那页的本地文件已经记账了，第 0 档会直接命中它
    // （那是**缓存命中**，不是「图片层坏了」的结论，复位不该、也没法把它赶走）
    const [fresh] = freshUrls()
    const again = fakeNode(['ok'])
    await loadPageImage(again, [fresh], { key: fresh, ...deps })
    expect(again.srcs).toEqual([fresh]) // 又从图片层开始试
  })

  it('预取：**图片层健康也照样下本地文件**（主路径就是本地，不问图片层），已记过的不重复下', async () => {
    const [proxy] = freshUrls()
    const files: string[] = []
    const deps = {
      downloadFile: async (url: string) => {
        files.push(url)
        return { statusCode: 200, tempFilePath: 'wxfile://tmp/warm.jpg' }
      },
    }
    // 全新会话、图片层健康：从前这条路会走 getImageInfo（图片层），现在必须走下载
    expect(isImageLayerBroken()).toBe(false)
    await prefetchPageImage(proxy, { key: proxy, ...deps })
    expect(files).toEqual([proxy])
    await prefetchPageImage(proxy, { key: proxy, ...deps }) // 已记账 ⇒ 不再下
    expect(files).toEqual([proxy])
    const [other] = freshUrls()
    await prefetchPageImage(other, { key: other, ...deps }) // 没记过 ⇒ 下它
    expect(files).toEqual([proxy, other])
  })

  it('记账键与入口无关：入口翻转（两条腿换了 URL）后，整册预下载的文件仍然命中', async () => {
    // 真实的翻转形态：`pageImageUrls` 返回的**第一条腿**从反代域名变成直连域名，
    // 键若取 urls[0] 就会全 miss（评审 2026-10-09 抓出的「整册预下载失联」）
    const [proxyA] = freshUrls()
    const [directB] = freshUrls()
    let downloads = 0
    const deps = {
      downloadFile: async () => {
        downloads += 1
        return { statusCode: 200, tempFilePath: `wxfile://tmp/keep-${downloads}.jpg` }
      },
    }
    const key = 'file-9#3'
    await prefetchPageImage(proxyA, { ...deps, key }) // 翻转前：泵按反代腿下好
    expect(downloads).toBe(1)
    const node = fakeNode(['ok']) // 图片层"可用"，但压根不该被问到
    await loadPageImage(node, [directB], { ...deps, key }) // 翻转后：按直连腿取
    expect(node.srcs).toEqual(['wxfile://tmp/keep-1.jpg']) // 命中翻转前那份文件
    expect(downloads).toBe(1) // 没有重下
  })

  it('预取下来的文件就是渲染源：之后的加载用本地路径、一次都不碰远端', async () => {
    const [proxy, direct] = freshUrls()
    const deps = {
      downloadFile: async () => ({ statusCode: 200, tempFilePath: 'wxfile://tmp/pre-1.jpg' }),
    }
    await prefetchPageImage(proxy, { key: proxy, ...deps })
    const node = fakeNode(['ok']) // 图片层"可用"，但压根不该被问到
    await loadPageImage(node, [proxy, direct], { key: proxy, ...deps })
    expect(node.srcs).toEqual(['wxfile://tmp/pre-1.jpg'])
  })
})

describe('loadPageImageWithRetry（失败退避重试）', () => {
  const noWait = () => Promise.resolve()
  const deps = { downloadFile: downloadNever } // 键在各调用点给（每次都是新的一页）

  it('默认配置：首次 + 两次重试 = 3 次尝试，抛的是最后一次的错误', async () => {
    const err = await fail(
      loadPageImageWithRetry(
        fakeNode([{ errMsg: 'first' }, { errMsg: 'second' }, { errMsg: 'third' }]),
        [freshUrls()[0]],
        { sleep: noWait, deps: { key: freshUrls()[0], ...deps } }
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
        deps: { key: freshUrls()[0], ...deps },
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
        deps: { key: freshUrls()[0], ...deps },
      })
    )
    expect(slept).toEqual([500, 1000]) // 两次重试各等一拍，第三次失败后不再等
  })
})
