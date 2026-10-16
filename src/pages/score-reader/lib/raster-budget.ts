/**
 * 位图画布的内存账 —— **我们自己分配了多少**，不是系统实际占了多少。
 *
 * 为什么需要（pkuso-mp#91）：微信不给任何查询内存的 API（`onMemoryWarning` 是唯一的外部
 * 信号，而且只在系统已经吃紧时才响），但**每一块位图的尺寸都是我们自己在三处定的**
 *（页图 `paintPageImage`、批注 `paintInkOn`、冲突页预览）⇒ 这份账是精确的、可单测的。
 *
 * 它要回答的是 #91 卡住的那个问题：**告警响起那一刻，账上有多少**。
 *（`raster.ts` 里每块 12M px ≈ 48MB 只是**上限**；适配缩放下页画布远不到它，
 * 所以「7 块 × 48MB = 336MB」是最坏值，不是实际值。）
 *
 * ⚠️ 记账 ≠ 控制：全仓今天没有任何释放路径（`width = 0` 零命中），而那是有意的
 *（离屏改位图尺寸很可能就是白帧来源，见 index.tsx 里那段说明）。这份账是给决策用的数据。
 *
 * ⚠️ 账本**不知道**谁卸载了：位图随画布节点销毁而释放，而挂载与否发生在 JSX 的判据里。
 * 所以读总数要用 `sumOf(当前挂载的那几个 id)`，**别用「所有条目之和」**。
 */

/** 一块 w×h 的位图占多少字节（RGBA 每像素 4 字节）；拿不到有限值时按 0，不产生 NaN 账 */
export function bitmapBytes(w: number, h: number): number {
  if (!Number.isFinite(w) || !Number.isFinite(h)) return 0
  return Math.max(0, Math.round(w)) * Math.max(0, Math.round(h)) * 4
}

/** 字节 → MB（保留 1 位小数）—— 上报里放这个数，原始字节没人看 */
export function bytesToMB(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10
}

export type BitmapLedger = {
  /** 记下「这个 id 的画布位图现在是 w×h」。可反复调（覆盖，不是累加）—— 每次上画都该重新记 */
  set: (id: string, w: number, h: number) => void
  /** 这几个 id 的字节和（**挂载着哪几块由调用方判**，见文件头） */
  sumOf: (ids: readonly string[]) => number
  /** 逐块明细（字节降序，只列有账的）—— 带上它才知道是谁占的 */
  detail: (ids: readonly string[]) => Array<{ id: string; bytes: number }>
}

export function createBitmapLedger(): BitmapLedger {
  const byId = new Map<string, number>()
  return {
    set: (id, w, h) => {
      byId.set(id, bitmapBytes(w, h))
    },
    sumOf: (ids) => ids.reduce((sum, id) => sum + (byId.get(id) ?? 0), 0),
    detail: (ids) =>
      ids
        .map((id) => ({ id, bytes: byId.get(id) ?? 0 }))
        .filter((e) => e.bytes > 0)
        .sort((a, b) => b.bytes - a.bytes),
  }
}
