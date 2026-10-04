import { describe, expect, it } from 'vitest'
import { loadPageImage, type PageImageError } from './page-image'
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

/** 断言「必须失败」，并把错误按 PageImageError 取出来 */
const fail = (p: Promise<unknown>): Promise<PageImageError> =>
  p.then(
    () => {
      throw new Error('本该失败却成功了')
    },
    (e) => e as PageImageError
  )

describe('loadPageImage 的失败信息（诊断用）', () => {
  it('onerror 的原文进 errMsg，并记下是第几条 URL 失败（0 = 反代那条腿）', async () => {
    const err = await fail(
      loadPageImage(fakeNode([{ errMsg: 'url not in domain list' }]), ['https://proxy/p1.jpg'])
    )
    expect(err.message).toBe('页图加载失败')
    expect(err.errMsg).toBe('url not in domain list')
    expect(err.urlIndex).toBe(0)
  })

  it('两条腿都失败：抛最后一条（urlIndex = 1 = 直连），errMsg 也跟着它', async () => {
    const err = await fail(
      loadPageImage(fakeNode([{ errMsg: 'proxy 502' }, { errMsg: 'direct timeout-ish' }]), [
        'https://proxy/p1.jpg',
        'https://direct/p1.jpg',
      ])
    )
    expect(err.urlIndex).toBe(1)
    expect(err.errMsg).toBe('direct timeout-ish')
  })

  it('第一条失败、第二条成功 ⇒ 正常返回，不当失败', async () => {
    const img = await loadPageImage(fakeNode([{ errMsg: 'proxy 502' }, 'ok']), ['a', 'b'])
    expect(img.width).toBe(10)
  })

  it('onerror 不带可用文案时不虚构：errMsg 为空', async () => {
    const err = await fail(loadPageImage(fakeNode([undefined]), ['a']))
    expect(err.errMsg).toBeUndefined()
    expect(err.urlIndex).toBe(0)
  })
})
