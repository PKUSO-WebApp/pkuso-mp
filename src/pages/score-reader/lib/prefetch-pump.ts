import Taro from '@tarojs/taro'

/**
 * 页图预热泵：**以当前页为中心**，把前后一个窗口的页图在后台预热进微信图片缓存。
 *
 * 为什么值得（2026-10-04 真机数据）：JPEG 模式下渲染已经免费（renderMs ≈ 0～1），
 * 翻页延迟全在 `infoMs`（取图）——没预热到的页要一次完整网络来回（实测 305–1661ms），
 * 命中图片缓存时只要 ~50ms。原来的「当前页 +3」预取在连续翻页 / 跳页时会被追上。
 *
 * 设计约束：
 * - **一律串行**（`PREFETCH_PARALLEL = 1`）：并发会和前台取图抢图片层的额度，
 *   真机上把前台那次取图挤失败过（见那个常量的注释）；
 * - **双向优先带**：前 PRIORITY_AHEAD 页 + 后 PRIORITY_BEHIND 页排在窗口填充之前；
 * - **窗口填充不许占满并发**（最多 `parallel - 1` 个槽），保证用户翻页时
 *   优先带立刻拿得到空槽——否则「正在补第 5 页」的几个慢请求会把「下一页」堵在后面；
 * - **窗口之外刻意不预热**（见 `nextPage` 的注释：整册铺满既费流量，又可能把要读的页挤出缓存）；
 * - **失败即跳过**（标记 done、不重排）：预热只是止损，真翻到那一页时前台加载路径
 *   有自己的超时 / 换入口 / 重试。
 *
 * ⚠️ 预热**必须走小程序的图片层**（`Taro.getImageInfo` / `createImage`）——微信自带
 * HTTP/磁盘图片缓存；不要换成 `Taro.downloadFile`，那个不走 HTTP 缓存，每次都是真下载。
 */

/** 优先带（前）：当前页之后这几页最先预热 */
export const PRIORITY_AHEAD = 3
/** 优先带（后）：回翻的那几页。**必须排在「继续向前」之前**——旧实现把向后的页交给
 *  「从第 1 页往上扫」顺带覆盖，结果是排最后、且 60 页以外完全没有，回翻能否命中全靠运气。 */
export const PRIORITY_BEHIND = 3
/** 窗口（前）：从当前页向前最多预热到这里（含优先带）≈ 20×510KB ≈ 10MB */
export const WINDOW_AHEAD = 20
/** 窗口（后）：从当前页向后最多预热到这里 */
export const WINDOW_BEHIND = 5

/**
 * 预热并发数：**固定 1（串行）**。
 *
 * 曾经按网络档位分档（wifi/5g=4、4g=3，理由是「缩短铺满整册的时间」），两件事让它作废：
 * 1. 今天改成窗口预热后，泵的收益只剩「更快填满一个小窗口」——串行实测 1–3s/页
 *    （真机 4G 经反代 0.3–1.2s/页），远快于读谱的一页十几秒，快慢根本感觉不到；
 * 2. 并发会和「前台正在取的那一页」抢**图片层的并发额度**：2026-10-04 真机实测，
 *    泵 4 个在飞 + 前台 1 个时，前台那次取图被图片层当场拒绝（onerror 无 errMsg、
 *    两条腿都没到服务器），用户看到「页图加载失败」。串行把同时在飞的图片层请求
 *    压到最多 2 个（泵 1 + 前台 1），从根上避开这类争用。
 *
 * ⚠️ 要再提高并发前，先想清楚怎么不让它和前台抢额度（例如前台取图期间把泵暂停）。
 */
export const PREFETCH_PARALLEL = 1

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
  priorityBehind?: number
  /** 窗口半径：向前/向后最多预热的页数（不传用模块常量） */
  windowAhead?: number
  windowBehind?: number
  /** 并发上限，默认 `PREFETCH_PARALLEL`（1 = 串行）；只在测试里改 */
  maxParallel?: number
}): PrefetchPump {
  const total = Math.max(0, Math.floor(opts.total))
  const urlsFor = opts.urlsFor
  const prefetchOne = opts.prefetchOne ?? ((url: string) => Taro.getImageInfo({ src: url }))
  const ahead = opts.priorityAhead ?? PRIORITY_AHEAD
  const behind = opts.priorityBehind ?? PRIORITY_BEHIND
  const winAhead = opts.windowAhead ?? WINDOW_AHEAD
  const winBehind = opts.windowBehind ?? WINDOW_BEHIND

  let current = 1
  let stopped = false
  let running = false
  let parallel = Math.min(Math.max(1, Math.floor(opts.maxParallel ?? PREFETCH_PARALLEL)), 8)
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

  /**
   * 下一件抓什么，按四级排：
   *   一、优先带（前）——翻下去就会看到的
   *   二、优先带（后）——回翻的那几页（**不能**排在"继续向前"后面，否则快速连翻/跳页时永远轮不到）
   *   三、窗口（前）到 current+winAhead
   *   四、窗口（后）到 current-winBehind
   * 窗口之外**刻意不预热**：整册铺满既费流量，又可能把"马上要读的那几页"挤出微信图片缓存
   * （预热反而在破坏命中率）。跳到某页后 setCurrent 会把窗口挪过去。
   */
  const nextPage = (): number | null => {
    const fwdEnd = Math.min(total, current + ahead)
    for (let n = current + 1; n <= fwdEnd; n += 1) if (!attempted.has(n)) return n
    for (let n = current - 1; n >= Math.max(1, current - behind); n -= 1)
      if (!attempted.has(n)) return n
    const winFwdEnd = Math.min(total, current + winAhead)
    for (let n = fwdEnd + 1; n <= winFwdEnd; n += 1) if (!attempted.has(n)) return n
    for (let n = current - behind - 1; n >= Math.max(1, current - winBehind); n -= 1)
      if (!attempted.has(n)) return n
    return null
  }

  /** 优先带 = 前/后各一段（顺序补全不许占满并发，留槽给它们） */
  const isPriority = (n: number): boolean =>
    (n > current && n <= current + ahead) || (n < current && n >= current - behind)

  const run = async (): Promise<void> => {
    if (running || stopped) return
    running = true
    const inFlight = new Set<Promise<void>>()
    let backfillInFlight = 0
    while (!stopped) {
      // 窗口填充最多占 parallel-1 个槽：优先带（翻下去/翻回来就会看到的那几页）永远留得住空槽
      const backfillLimit = Math.max(1, parallel - 1)
      while (!stopped && inFlight.size < parallel) {
        const p = nextPage()
        if (p === null) break
        const priority = isPriority(p)
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
