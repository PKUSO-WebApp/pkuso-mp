import { describe, expect, it } from 'vitest'
import { createPrefetchPump, parallelForNetwork } from './prefetch-pump'

/** 把泵的循环排空（注入的 prefetchOne 只 resolve 微任务，无计时器） */
const flush = async (rounds = 80) => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve()
}

describe('createPrefetchPump', () => {
  it('先补优先带（当前页 +3），再从第 1 页顺序补全', async () => {
    const calls: number[] = []
    const pump = createPrefetchPump({
      total: 6,
      urlsFor: (p) => [`https://x/p${p}.jpg`],
      prefetchOne: async (url) => {
        calls.push(Number(url.match(/p(\d+)/)?.[1]))
      },
    })
    pump.setCurrent(1)
    await flush()
    expect(calls).toEqual([2, 3, 4, 5, 6])
  })

  it('抓取在途时翻到第 8 页：优先带插队到 9/10，之后再回头补空洞', async () => {
    const calls: number[] = []
    const pump = createPrefetchPump({
      total: 10,
      urlsFor: (p) => [String(p)],
      prefetchOne: async (url) => {
        const n = Number(url)
        calls.push(n)
        // 模拟「第一张还在抓的时候，用户翻到了第 8 页」
        if (n === 2) pump.setCurrent(8)
      },
    })
    pump.setCurrent(1)
    await flush()
    expect(calls).toEqual([2, 9, 10, 3, 4, 5, 6, 7])
  })

  it('某页失败即跳过、不重排、不中断', async () => {
    const calls: number[] = []
    const pump = createPrefetchPump({
      total: 4,
      urlsFor: (p) => [String(p)],
      prefetchOne: async (url) => {
        calls.push(Number(url))
        if (url === '3') throw new Error('boom')
      },
    })
    pump.setCurrent(1)
    await flush()
    expect(calls).toEqual([2, 3, 4]) // 3 失败后继续 4
    expect(calls.filter((n) => n === 3)).toHaveLength(1) // 且不重试
  })

  it('stop 后不再发起新的抓取（在途的完成即止）', async () => {
    const calls: number[] = []
    const pump = createPrefetchPump({
      total: 10,
      urlsFor: (p) => [String(p)],
      prefetchOne: async (url) => {
        calls.push(Number(url))
        if (calls.length === 1) pump.stop() // 第一张在途时被喊停
      },
    })
    pump.setCurrent(1)
    await flush()
    expect(calls).toEqual([2])
  })

  it('顺序补全受 maxPages 限制；优先带不受限制', async () => {
    const calls: number[] = []
    const pump = createPrefetchPump({
      total: 100,
      urlsFor: (p) => [String(p)],
      prefetchOne: async (url) => {
        calls.push(Number(url))
      },
      maxPages: 5,
    })
    pump.setCurrent(1)
    await flush()
    expect(calls).toEqual([2, 3, 4, 5]) // 只补到第 5 页
    pump.setCurrent(90)
    await flush()
    expect(calls).toEqual([2, 3, 4, 5, 91, 92, 93]) // 跳到 90 也先备好后面 3 页
  })

  it('setCurrent 不重复抓当前页（前台路径负责它）', async () => {
    const calls: number[] = []
    const pump = createPrefetchPump({
      total: 6,
      urlsFor: (p) => [String(p)],
      prefetchOne: async (url) => {
        calls.push(Number(url))
      },
    })
    pump.setCurrent(3)
    await flush()
    expect(calls).toEqual([4, 5, 6, 1, 2])
    expect(calls).not.toContain(3)
  })

  it('并发档位：maxParallel=3 时优先带整批同时发、最多 3 个在途', async () => {
    const started: number[] = []
    const gates: Array<() => void> = []
    const pump = createPrefetchPump({
      total: 10,
      urlsFor: (p) => [String(p)],
      prefetchOne: (url) =>
        new Promise<void>((resolve) => {
          started.push(Number(url))
          gates.push(resolve)
        }),
      maxParallel: 3,
    })
    pump.setCurrent(1)
    await flush()
    expect(started).toEqual([2, 3, 4]) // 优先带三个同时发
    gates[0]() // 完成一个 → 补一个
    await flush()
    expect(started).toEqual([2, 3, 4, 5])
  })

  it('setParallel 运行中调高：下一轮补足到新的并发', async () => {
    const started: number[] = []
    const gates: Array<() => void> = []
    const pump = createPrefetchPump({
      total: 10,
      urlsFor: (p) => [String(p)],
      prefetchOne: (url) =>
        new Promise<void>((resolve) => {
          started.push(Number(url))
          gates.push(resolve)
        }),
    })
    pump.setCurrent(1)
    await flush()
    expect(started).toEqual([2]) // 默认串行
    pump.setParallel(3)
    gates[0]()
    await flush()
    expect(started).toEqual([2, 3, 4, 5]) // 补足到 3 个在途
  })

  it('网络档位 → 并发数', () => {
    expect(parallelForNetwork('wifi')).toBe(4)
    expect(parallelForNetwork('5g')).toBe(4)
    expect(parallelForNetwork('4g')).toBe(3)
    expect(parallelForNetwork('3g')).toBe(1)
    expect(parallelForNetwork('unknown')).toBe(1)
  })
})
