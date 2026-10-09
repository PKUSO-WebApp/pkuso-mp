import { describe, expect, it } from 'vitest'
import { createPrefetchPump, PREFETCH_PARALLEL } from './prefetch-pump'

/** 把泵的循环排空（注入的 prefetchOne 只 resolve 微任务，无计时器） */
const flush = async (rounds = 80) => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve()
}

describe('createPrefetchPump', () => {
  it('当前页最先、再向前 3、向后 3，然后向前填到窗口边界、最后向后', async () => {
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
    // 当前页 5 → 前带 6,7,8 → 后带 4,3,2 → 前窗 9,10；后窗只到 5-2=3，1 在窗口外**刻意不预热**
    expect(calls).toEqual([5, 6, 7, 8, 4, 3, 2, 9, 10])
    expect(calls).not.toContain(1)
  })

  it('抓取在途时翻到第 8 页：当前页与 9/10 插队，随后是**后带** 7/6/5', async () => {
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
    // 1、2 之后用户翻到 8：8（当前页）→ 9,10（前带）→ 7,6,5（后带，回翻要用的那几页）
    // 紧跟其后——旧实现会先补 4,3（从那时的 current 起往前扫），回翻的页排在最后
    expect(calls).toEqual([1, 2, 8, 9, 10, 7, 6, 5, 4, 3])
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
    expect(calls).toEqual([1, 2, 3, 4]) // 3 失败后继续 4
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
    expect(calls).toEqual([1])
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
    // 当前页 50 → 前带 51,52,53 → 后带 49 → 前窗 54 → 后窗（50-1-1=48，已越过后带的下界）
    expect(calls).toEqual([50, 51, 52, 53, 49, 54])
    expect(calls).not.toContain(1) // 远处不预热：铺满整册既费流量、又把要读的页挤到队尾
    pump.setCurrent(90)
    await flush()
    expect(calls).toEqual([50, 51, 52, 53, 49, 54, 90, 91, 92, 93, 89, 94])
  })

  it('当前页也抓（它必须落本地），但**不会重复**抓——重复 setCurrent 不重排', async () => {
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
    expect(calls).toEqual([3, 4, 5, 6, 2, 1]) // 当前页 → 前带 → 后带（从近到远）
    pump.setCurrent(3)
    await flush()
    expect(calls.filter((n) => n === 3)).toHaveLength(1) // 记过就不再来一次（否则会无限重下）
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
    expect(started).toEqual([1, 2, 3]) // 当前页 + 前带两个，整批同时发
    gates[0]() // 完成一个 → 补一个
    await flush()
    expect(started).toEqual([1, 2, 3, 4])
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
      maxParallel: 1,
    })
    pump.setCurrent(1)
    await flush()
    expect(started).toEqual([1]) // 串行：一次一个
    pump.setParallel(3)
    await flush()
    expect(started).toEqual([1, 2, 3]) // 补足到 3 个在途（不等在途那个回来）
    gates[0]()
    await flush()
    expect(started).toEqual([1, 2, 3, 4])
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
    expect(started).toEqual([1, 2, 3]) // 优先带整批先发
    gates[0]()
    gates[1]()
    gates[2]()
    await flush()
    expect(started).toEqual([1, 2, 3, 4, 5, 6]) // 补全只占 parallel-1 = 2 个槽，留 1 个
    gates[3]() // 4 完成：空出来的槽**不会被补全抢走**（5、6 还在途，补全已占满 2 个）
    await flush()
    expect(started).toEqual([1, 2, 3, 4, 5, 6])
    pump.setCurrent(50)
    await flush()
    expect(started).toEqual([1, 2, 3, 4, 5, 6, 50]) // 用户翻页 → 优先带立刻拿到留出的那个槽
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
    // 当前页与其余各页都要落本地（当前页不再被排除）
    expect([...started].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('失败回调带上页码与原因（从前这里是空的 = 线上无声）、排空回调 onIdle 一次', async () => {
    const fails: Array<[number, unknown]> = []
    let idles = 0
    const pump = createPrefetchPump({
      total: 3,
      urlsFor: (p) => [String(p)],
      prefetchOne: async (url) => {
        if (url === '2') throw new Error('页图下载失败：HTTP 502')
      },
      onFail: (page, err) => fails.push([page, err]),
      onIdle: () => {
        idles += 1
      },
    })
    pump.setCurrent(1)
    await flush()
    expect(fails.map(([p]) => p)).toEqual([2])
    expect(String(fails[0][1])).toContain('502')
    expect(idles).toBe(1)
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
    expect(pump.isDone(1)).toBe(true) // 当前页也抓
    expect(pump.isWarm(1)).toBe(true)
    expect(pump.isDone(99)).toBe(false)
  })

  it('默认并发 4（泵走 downloadFile，不再和图片层抢额度）', async () => {
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
    expect(PREFETCH_PARALLEL).toBe(4)
    expect(started).toEqual([1, 2, 3, 4]) // 四个在途
    gates[0]()
    await flush()
    expect(started).toEqual([1, 2, 3, 4, 5])
  })
})

describe('离线闸门（isOnline）', () => {
  it('离线时一页都不抓，且**不算排空**（onIdle 不响）', async () => {
    const calls: number[] = []
    let idle = 0
    const pump = createPrefetchPump({
      total: 5,
      urlsFor: (p) => [String(p)],
      prefetchOne: async (url) => {
        calls.push(Number(url))
      },
      isOnline: () => false,
      onIdle: () => {
        idle += 1
      },
    })
    pump.setCurrent(2)
    await flush()
    expect(calls).toEqual([])
    // 关键：onIdle 会让调用方把这一册「结账」上报（且只报一次）——什么都没抓时绝不能响
    expect(idle).toBe(0)
    // 也**没有**把页标记成抓过：联网后仍要抓它（标记 attempted 就等于永久放弃这一页）
    expect(pump.isDone(2)).toBe(false)
  })

  it('离线进册后网络恢复：再 setCurrent 一次就把整册补上', async () => {
    const calls: number[] = []
    let online = false
    const pump = createPrefetchPump({
      total: 4,
      urlsFor: (p) => [String(p)],
      prefetchOne: async (url) => {
        calls.push(Number(url))
      },
      isOnline: () => online,
    })
    pump.setCurrent(1)
    await flush()
    expect(calls).toEqual([])
    online = true
    pump.setCurrent(1) // 网络恢复的信号（阅读器在 onReconnect 里这么调）
    await flush()
    expect(calls).toEqual([1, 2, 3, 4])
  })

  it('联网后中途掉线：按既有「失败即跳过」处理，不半路掐断', async () => {
    // 入口判一次 ⇒ 已经在跑的循环不受影响（半路退出会把在途请求留在空转的循环里）
    let online = true
    const calls: number[] = []
    const pump = createPrefetchPump({
      total: 3,
      urlsFor: (p) => [String(p)],
      prefetchOne: async (url) => {
        calls.push(Number(url))
        online = false // 第一页抓到一半掉线
      },
      isOnline: () => online,
    })
    pump.setCurrent(1)
    await flush()
    expect(calls).toEqual([1, 2, 3])
  })

  it('不注入 isOnline 时行为与从前完全一致（照抓）', async () => {
    const calls: number[] = []
    const pump = createPrefetchPump({
      total: 2,
      urlsFor: (p) => [String(p)],
      prefetchOne: async (url) => {
        calls.push(Number(url))
      },
    })
    pump.setCurrent(1)
    await flush()
    expect(calls).toEqual([1, 2])
  })
})
