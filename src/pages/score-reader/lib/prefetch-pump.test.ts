import { describe, expect, it } from 'vitest'
import { createPrefetchPump, PREFETCH_PARALLEL } from './prefetch-pump'

/** 把泵的循环排空（注入的 prefetchOne 只 resolve 微任务，无计时器） */
const flush = async (rounds = 80) => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve()
}

describe('createPrefetchPump', () => {
  it('先向前 3、再向后 3，然后向前填到窗口边界、最后向后', async () => {
    const calls: number[] = []
    const pump = createPrefetchPump({
      total: 14,
      urlsFor: (p) => [`https://x/p${p}.jpg`],
      prefetchOne: async (url) => {
        calls.push(Number(url.match(/p(\d+)/)?.[1]))
      },
      // 窗口收到 +5/−2，把顺序一次看全
      windowAhead: 5,
      windowBehind: 2,
    })
    pump.setCurrent(5)
    await flush()
    // 前带 6,7,8 → 后带 4,3,2 → 前窗 9,10；后窗只到 5-2=3，1 在窗口外**刻意不预热**
    expect(calls).toEqual([6, 7, 8, 4, 3, 2, 9, 10])
    expect(calls).not.toContain(1)
  })

  it('抓取在途时翻到第 8 页：前带插队 9/10，随后是**后带** 7/6/5', async () => {
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
    // 回翻要用的 7/6/5 紧跟在前带之后——旧实现会先补 3,4,5,6,7（从第 1 页往上扫），
    // 回翻的那一页排在最后。1 距第 8 页超过窗口（8-5=3），不再预热
    expect(calls).toEqual([2, 9, 10, 7, 6, 5, 4, 3])
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

  it('只预热当前页 ±窗口，**不铺整册**；setCurrent 挪窗口后继续', async () => {
    const calls: number[] = []
    const pump = createPrefetchPump({
      total: 100,
      urlsFor: (p) => [String(p)],
      prefetchOne: async (url) => {
        calls.push(Number(url))
      },
      windowAhead: 4,
      windowBehind: 1,
      priorityBehind: 1,
    })
    pump.setCurrent(50)
    await flush()
    // 前带 51,52,53 → 后带 49 → 前窗 54 → 后窗（50-4=46，已被后带 49 覆盖）
    expect(calls).toEqual([51, 52, 53, 49, 54])
    expect(calls).not.toContain(1) // 远处不预热：整册铺满既费流量、又会把要读的页挤出缓存
    pump.setCurrent(90)
    await flush()
    expect(calls).toEqual([51, 52, 53, 49, 54, 91, 92, 93, 89, 94])
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
    expect(calls).toEqual([4, 5, 6, 2, 1]) // 前带 → 后带（从近到远）
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

  it('顺序补全不占满并发：优先带永远留得住一个空槽', async () => {
    const started: number[] = []
    const gates: Array<() => void> = []
    const pump = createPrefetchPump({
      total: 100,
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
    expect(started).toEqual([2, 3, 4]) // 优先带整批先发
    gates[0]()
    gates[1]()
    gates[2]()
    await flush()
    expect(started).toEqual([2, 3, 4, 5, 6]) // 补全只占 parallel-1 = 2 个槽，留 1 个
    pump.setCurrent(50)
    await flush()
    expect(started).toEqual([2, 3, 4, 5, 6, 51]) // 用户翻页 → 优先带立刻拿到留出的那个槽
  })

  it('预留槽不会把顺序补全饿死：整册照样铺完（并发 > 1）', async () => {
    const started: number[] = []
    const pump = createPrefetchPump({
      total: 8,
      urlsFor: (p) => [String(p)],
      prefetchOne: async (url) => {
        started.push(Number(url))
      },
      maxParallel: 3,
    })
    pump.setCurrent(1)
    await flush()
    // 第 1 页是当前页（前台路径负责），泵不抓它，其余全铺完
    expect([...started].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8])
  })

  it('isDone / isWarm：失败的页抓过但没预热', async () => {
    const pump = createPrefetchPump({
      total: 4,
      urlsFor: (p) => [String(p)],
      prefetchOne: async (url) => {
        if (url === '3') throw new Error('boom')
      },
    })
    pump.setCurrent(1)
    await flush()
    expect(pump.isDone(3)).toBe(true) // 抓过
    expect(pump.isWarm(3)).toBe(false) // 但没进缓存
    expect(pump.isWarm(2)).toBe(true)
    expect(pump.isDone(1)).toBe(true) // 当前页由前台路径负责，记 done
    expect(pump.isWarm(1)).toBe(false)
    expect(pump.isDone(99)).toBe(false)
  })

  it('默认串行：不传 maxParallel 时一次只抓一页（并发会和前台取图抢图片层额度）', async () => {
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
    expect(started).toEqual([2]) // 只起一个
    expect(PREFETCH_PARALLEL).toBe(1)
    gates[0]()
    await flush()
    expect(started).toEqual([2, 3])
  })
})
