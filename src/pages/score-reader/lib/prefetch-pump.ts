import Taro from '@tarojs/taro'

/**
 * 页图预热泵：开卷后把**整册**页图按顺序在后台预热进微信图片缓存。
 *
 * 为什么值得（2026-10-04 真机数据）：JPEG 模式下渲染已经免费（renderMs ≈ 0～1），
 * 翻页延迟全在 `infoMs`（取图）——没预热到的页要一次完整网络来回（实测 305–1661ms），
 * 命中图片缓存时只要 ~50ms。原来的「当前页 +3」预取在连续翻页 / 跳页时会被追上。
 *
 * 设计约束：
 * - **有界并发**：默认 1（串行）；调用方按网络档位调高（`parallelForNetwork`：
 *   wifi/5g → 4、4g → 3、其余 → 1）。弱网下并发是负收益——用户正在等的那一页
 *   会和预热抢带宽；
 * - **优先带**：当前页之后 PRIORITY_AHEAD 页永远排在「补全整册」之前（翻到哪都有）；
 *   并且**顺序补全不许占满并发**（最多 `parallel - 1` 个槽），保证用户翻页时
 *   优先带立刻拿得到空槽——否则「正在补第 3 页」的四个慢请求会把「下一页」堵在后面；
 * - **失败即跳过**（标记 done、不重排）：预热只是止损，真翻到那一页时前台加载路径
 *   有自己的超时 / 换入口 / 重试；
 * - MAX_BACKFILL_PAGES 只约束「顺序补全」的页序号上限；优先带不受限（跳到第 90 页
 *   也照样先备好 91–93）。
 *
 * ⚠️ 预热**必须走小程序的图片层**（`Taro.getImageInfo` / `createImage`）——微信自带
 * HTTP/磁盘图片缓存；不要换成 `Taro.downloadFile`，那个不走 HTTP 缓存，每次都是真下载。
 */

/** 优先带宽度：当前页之后这几页先于「补全整册」被预热 */
export const PRIORITY_AHEAD = 3
/** 顺序补全的上限（页序号）。册子超过它时只补到第 N 页；优先带不受此限 */
export const MAX_BACKFILL_PAGES = 60

/**
 * 网络档位 → 预热并发数。快网多拉（缩短铺满整册的时间）；弱网老实串行
 * （并发会和用户正在等的那一页抢带宽）。unknown / 2g / none 一律按最保守算。
 */
export function parallelForNetwork(networkType: string): number {
  if (networkType === 'wifi' || networkType === '5g') return 4
  if (networkType === '4g') return 3
  return 1
}

export type PrefetchPump = {
  /** 翻到某页时调用：挪动优先带并确保泵在跑（当前页由前台路径负责，泵不重复抓） */
  setCurrent(page: number): void
  /** 调整并发（按网络档位；运行中调用会在下一轮补足时生效） */
  setParallel(n: number): void
  /** 这一页是否抓过（含失败）——「不重复抓」的记账 */
  isDone(page: number): boolean
  /** 这一页是否**成功**抓过（图片缓存里应该有它）。诊断的 `warm` 与预绘制据此决定等不等 */
  isWarm(page: number): boolean
  /** 退出页面 / 换册时调用 */
  stop(): void
}

export function createPrefetchPump(opts: {
  total: number
  urlsFor: (page: number) => string[]
  /** 测试注入用；默认走小程序图片层（微信自带缓存） */
  prefetchOne?: (url: string) => Promise<unknown>
  priorityAhead?: number
  maxPages?: number
  /** 并发上限，默认 1（串行）；调用方通常随后用 setParallel 按网络档位调 */
  maxParallel?: number
}): PrefetchPump {
  const total = Math.max(0, Math.floor(opts.total))
  const urlsFor = opts.urlsFor
  const prefetchOne = opts.prefetchOne ?? ((url: string) => Taro.getImageInfo({ src: url }))
  const ahead = opts.priorityAhead ?? PRIORITY_AHEAD
  const maxPages = opts.maxPages ?? MAX_BACKFILL_PAGES

  let current = 1
  let stopped = false
  let running = false
  let parallel = Math.min(Math.max(1, Math.floor(opts.maxParallel ?? 1)), 8)
  /** 抓过的页（含失败） */
  const attempted = new Set<number>()
  /** 成功抓到的页 */
  const warmed = new Set<number>()
  /** 唤醒句柄：跑着的时候 setCurrent/setParallel 靠它把循环从等待里叫醒（否则留出的空槽要等某个请求超时才被用上） */
  let wake: (() => void) | null = null

  const wakeLoop = () => {
    const w = wake
    wake = null
    if (w) w()
  }

  const nextPage = (): number | null => {
    // 一、优先带：当前页之后 ahead 页之内，先保「翻下去就有」
    const zoneEnd = Math.min(total, current + ahead)
    for (let n = current + 1; n <= zoneEnd; n += 1) if (!attempted.has(n)) return n
    // 二、顺序补全：从第 1 页往上扫，把前面的空洞按顺序填掉
    const backfillEnd = Math.min(total, maxPages)
    for (let n = 1; n <= backfillEnd; n += 1) if (!attempted.has(n)) return n
    return null
  }

  const run = async (): Promise<void> => {
    if (running || stopped) return
    running = true
    const inFlight = new Set<Promise<void>>()
    let backfillInFlight = 0
    while (!stopped) {
      // 顺序补全最多占 parallel-1 个槽：优先带（用户翻下去就会看到的那几页）永远留得住空槽
      const backfillLimit = Math.max(1, parallel - 1)
      while (!stopped && inFlight.size < parallel) {
        const p = nextPage()
        if (p === null) break
        const priority = p > current && p <= current + ahead
        if (!priority && backfillInFlight >= backfillLimit) break
        attempted.add(p) // 先标记：抓失败也不重排（见文件头「失败即跳过」）
        if (!priority) backfillInFlight += 1
        const task: Promise<void> = prefetchOne(urlsFor(p)[0])
          .then(
            () => {
              warmed.add(p)
            },
            () => {}
          )
          .then(() => {
            inFlight.delete(task)
            if (!priority) backfillInFlight -= 1
          })
        inFlight.add(task)
      }
      if (inFlight.size === 0) break
      await Promise.race([
        ...inFlight,
        new Promise<void>((resolve) => {
          wake = resolve
        }),
      ])
    }
    running = false
  }

  return {
    setCurrent(page: number) {
      current = Math.min(Math.max(1, Math.floor(page)), Math.max(1, total))
      attempted.add(current) // 当前页由前台路径负责（正在/已经加载），泵不重复抓
      wakeLoop()
      void run()
    },
    setParallel(n: number) {
      parallel = Math.min(Math.max(1, Math.floor(n)), 8)
      wakeLoop() // 运行中：立刻按新并发补足，而不是等某个请求回来
      void run()
    },
    isDone: (page) => attempted.has(page),
    isWarm: (page) => warmed.has(page),
    stop() {
      stopped = true
      wakeLoop()
    },
  }
}
