import Taro from '@tarojs/taro'

/**
 * 页图预热泵：**以当前页为中心**，把页图在后台按优先级抓下来（现在落本地文件，
 * 见 `prefetchPageImage`；从前是预热进微信图片缓存）。
 *
 * 为什么值得（2026-10-04 真机数据）：JPEG 模式下渲染已经免费（renderMs ≈ 0～1），
 * 翻页延迟全在取图——没预热到的页要一次完整网络来回（实测 305–1661ms），
 * 命中本地文件时只要 ~50ms。原来的「当前页 +3」预取在连续翻页 / 跳页时会被追上。
 *
 * 设计约束：
 * - **双向优先带**：前 PRIORITY_AHEAD 页 + 后 PRIORITY_BEHIND 页排在窗口填充之前；
 * - **窗口填充不许占满并发**（最多 `parallel - 1` 个槽），保证用户翻页时
 *   优先带立刻拿得到空槽——否则「正在补第 5 页」的几个慢请求会把「下一页」堵在后面；
 * - **窗口之外不预热**（见 `nextPage`）：谱务阅读器现在传的是**整册**
 *   （窗口概念退役，2026-10-09，见 index.tsx 的 createPrefetchPump），
 *   这段窗口逻辑留给别的调用方与用例；
 * - **失败即跳过**（标记 done、不重排）：预热只是止损，真翻到那一页时前台加载路径
 *   有自己的超时 / 换入口 / 重试。
 */

/** 优先带（前）：当前页之后这几页最先预热 */
export const PRIORITY_AHEAD = 3
/** 优先带（后）：回翻的那几页。**必须排在「继续向前」之前**——旧实现把向后的页交给
 *  「从第 1 页往上扫」顺带覆盖，结果是排最后、且 60 页以外完全没有，回翻能否命中全靠运气。 */
export const PRIORITY_BEHIND = 3
/**
 * 窗口（前）默认值：从当前页向前最多预热到这里（含优先带）。
 * ⚠️ 谱务阅读器**不用**这两个默认值——它传的是整册（窗口概念退役，见 index.tsx 的
 * `createPrefetchPump`）。默认值只留给窗口化预取的场景与用例。
 */
export const WINDOW_AHEAD = 20
/** 窗口（后）默认值；同上 */
export const WINDOW_BEHIND = 5

/**
 * 预热并发数：**4**（2026-10-09 从 1 提上来）。
 *
 * 串行的时代：泵走的是**小程序图片层**（`getImageInfo`），而并发会和前台抢图片层的额度
 * ——2026-10-04 真机实测，泵 4 个在飞 + 前台 1 个时，前台那次取图被图片层当场拒绝
 * （onerror 无 errMsg、两条腿都没到服务器），用户看到「页图加载失败」。串行把在飞的
 * 图片层请求压到最多 2 个，从根上避开争用。
 *
 * 那之后泵改成走 `downloadFile`（见 `prefetchPageImage`），**不再经过图片层**，抢额度的
 * 前提消失；换成网络额度约束：`request` / `uploadFile` / `downloadFile` **合计 10 个**
 * （基础库 1.4.0 起超出的排队不丢弃）。4 个留给泵、6 个留给 app 自身的请求与前台兜底腿。
 *
 * ⚠️ 再往上抬之前先看这条：额度是**三类请求共享**的，泵独占太多会让登录/查询排在后面。
 */
export const PREFETCH_PARALLEL = 4

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
  /** 测试注入用；默认走小程序图片层（微信自带缓存）。第二个参数是页号（记账键要用） */
  prefetchOne?: (url: string, page: number) => Promise<unknown>
  priorityAhead?: number
  priorityBehind?: number
  /** 窗口半径：向前/向后最多预热的页数（不传用模块常量） */
  windowAhead?: number
  windowBehind?: number
  /** 并发上限，默认 `PREFETCH_PARALLEL`（1 = 串行）；只在测试里改 */
  maxParallel?: number
  /**
   * 抓某一页失败时回调（页码 + 原始错误）。**失败本身仍按「跳过、不重排」处理**，
   * 这个钩子只是让调用方看得见——阅读器拿它上报（预下载是后台行为，不给用户弹东西，
   * 那它失败了就没人知道；线上判读「用户到底遇到什么」全指望这条）。
   */
  onFail?: (page: number, err: unknown) => void
  /** 队列排空（该抓的都抓过、没有在途）时回调一次——调用方拿它上报这一册的取图来源/失败数 */
  onIdle?: () => void
  /**
   * 网络探针：返回 false 时**一页都不派**。离线时进册不该派出一串必然失败的请求——
   * 那既把错误表刷满，又白等一轮超时。联网后调用方再 `setCurrent` 一次即可重新起泵
   * （`run()` 每次都会重新判）。
   *
   * ⚠️ 只在 `run()` 的**入口**判一次：中途掉线仍走既有的「失败即跳过」，不在这里
   * 半路掐断（`getNetworkType` 在弱网下本来也说不准，而且半路退出会把在途请求留在
   * 一个空转的循环里）。默认恒 true = 与从前完全一致。
   */
  isOnline?: () => boolean
}): PrefetchPump {
  const total = Math.max(0, Math.floor(opts.total))
  const urlsFor = opts.urlsFor
  const online = opts.isOnline ?? (() => true)
  const prefetchOne = opts.prefetchOne ?? ((url: string) => Taro.getImageInfo({ src: url }))
  const ahead = opts.priorityAhead ?? PRIORITY_AHEAD
  const behind = opts.priorityBehind ?? PRIORITY_BEHIND
  const winAhead = opts.windowAhead ?? WINDOW_AHEAD
  const winBehind = opts.windowBehind ?? WINDOW_BEHIND
  const onFail = opts.onFail
  const onIdle = opts.onIdle

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
   * 下一件抓什么，按五级排：
   *   一、**当前页**——用户正看着的这一页也要落本地（见 setCurrent 的注释）；
   *   二、优先带（前）——翻下去就会看到的
   *   三、优先带（后）——回翻的那几页（**不能**排在"继续向前"后面，否则快速连翻/跳页时永远轮不到）
   *   四、窗口（前）到 current+winAhead
   *   五、窗口（后）到 current-winBehind
   * 窗口之外**不预热**：铺满整册既费流量，又会把"马上要读的那几页"挤到队尾。
   * 跳到某页后 setCurrent 会把窗口挪过去。
   */
  const nextPage = (): number | null => {
    if (!attempted.has(current)) return current
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

  /** 优先带 = 当前页 + 前后各一段（顺序补全不许占满并发，留槽给它们） */
  const isPriority = (n: number): boolean =>
    n === current || (n > current && n <= current + ahead) || (n < current && n >= current - behind)

  const run = async (): Promise<void> => {
    if (running || stopped) return
    // 离线：一页都不派，**也不算排空**（`onIdle` 不响——那会让调用方把这一册结账上报了，
    // 而其实什么都没抓）。联网后调用方再 setCurrent 一次，run() 重新进来即可。
    if (!online()) return
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
        const task: Promise<void> = prefetchOne(urlsFor(p)[0], p)
          .then(
            () => {
              warmed.add(p)
            },
            (err) => {
              // 失败即跳过（不重排、不重试），但**要让人看得见**：从前这里是空的，
              // 预下载整册失败在线上完全无声（见 opts.onFail 的注释）
              onFail?.(p, err)
            }
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
    // 排空 = 该抓的都抓过了（含失败），调用方可以结账了。会随 setCurrent 再次触发
    if (!stopped) onIdle?.()
  }

  return {
    setCurrent(page: number) {
      current = Math.min(Math.max(1, Math.floor(page)), Math.max(1, total))
      // ⚠️ 这里**不再**把当前页标记成 attempted（2026-10-09）。从前那行的理由（「当前页由
      // 前台路径负责」）在预取改为落本地文件后不成立了：前台的取图走图片层，不产生本地文件，
      // 于是**用户翻过/滑过的每一页都被永久排除在预下载之外**——而它们恰恰是最可能被回看的。
      // 与首帧抢带宽的顾虑改由调用方解决：**首帧落地（stage ready）之后才启动泵**。
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
