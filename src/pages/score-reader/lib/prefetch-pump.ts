import Taro from '@tarojs/taro'

/**
 * 页图预热泵：开卷后把**整册**页图按顺序在后台预热进微信图片缓存。
 *
 * 为什么值得（2026-10-04 真机数据）：JPEG 模式下渲染已经免费（renderMs ≈ 0～1），
 * 翻页延迟全在 `infoMs`（取图）——没预热到的页要一次完整网络来回（实测 305–1661ms），
 * 命中图片缓存时只要 ~50ms。原来的「当前页 +3」预取在连续翻页 / 跳页时会被追上。
 *
 * 设计约束：
 * - **串行**（一次只抓一张）：弱网下不与「正在看的页」抢带宽；
 * - **优先带**：当前页之后 PRIORITY_AHEAD 页永远排在「补全整册」之前（翻到哪都有）；
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

export type PrefetchPump = {
  /** 翻到某页时调用：挪动优先带并确保泵在跑（当前页由前台路径负责，泵不重复抓） */
  setCurrent(page: number): void
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
}): PrefetchPump {
  const total = Math.max(0, Math.floor(opts.total))
  const urlsFor = opts.urlsFor
  const prefetchOne = opts.prefetchOne ?? ((url: string) => Taro.getImageInfo({ src: url }))
  const ahead = opts.priorityAhead ?? PRIORITY_AHEAD
  const maxPages = opts.maxPages ?? MAX_BACKFILL_PAGES

  let current = 1
  let stopped = false
  let running = false
  const done = new Set<number>()

  const nextPage = (): number | null => {
    // 一、优先带：当前页之后 ahead 页之内，先保「翻下去就有」
    const zoneEnd = Math.min(total, current + ahead)
    for (let n = current + 1; n <= zoneEnd; n += 1) if (!done.has(n)) return n
    // 二、顺序补全：从第 1 页往上扫，把前面的空洞按顺序填掉
    const backfillEnd = Math.min(total, maxPages)
    for (let n = 1; n <= backfillEnd; n += 1) if (!done.has(n)) return n
    return null
  }

  const run = async (): Promise<void> => {
    if (running || stopped) return
    running = true
    while (!stopped) {
      const p = nextPage()
      if (p === null) break
      done.add(p) // 先标记：抓失败也不重排（见文件头「失败即跳过」）
      try {
        await prefetchOne(urlsFor(p)[0])
      } catch {
        // 预热失败无所谓——真翻到这页时前台加载路径会兜底
      }
    }
    running = false
  }

  return {
    setCurrent(page: number) {
      current = Math.min(Math.max(1, Math.floor(page)), Math.max(1, total))
      done.add(current) // 当前页由前台路径负责（正在/已经加载），泵不重复抓
      void run()
    },
    stop() {
      stopped = true
    },
  }
}
