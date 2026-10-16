import type { AnnoDoc, AnnoStroke } from '@/lib/annotation'
import { ALL_LAYERS } from './predraw'
import type { Layer } from './types'

/**
 * 笔迹数据的**变更流**，以及「画布该怎么响应」的**唯一判据**。
 *
 * ## 为什么要这一层
 *
 * 2026-10-16 定（见 `pkusoweb/批注绘制-结构调查.md` §2-6）：这个模块里所有性能毛病是**同一个
 * 结构缺失**在好几处的表现 —— 数据（`annos`）只暴露「**它变了**」，从不表达「**变了什么**」。
 * 于是每个消费者只能自己猜，而猜的方式统一是「**整份重建**」：
 *
 * - 画布：任何 `annos` 变化 → 清空三块、所有笔迹从头重画（实测 **139–156ms**）
 * - 存盘：任何变化 → 整册序列化 + 同步写盘（实测 **106ms**）
 * - 落笔过程中：每个触点 → 重画整条在画的线
 *
 * ⚠️ **2026-10-16 订正**：上面那条 139–156ms 当时被写成「随页面墨量增长」，**数据不支持** ——
 * 后来量到「补一笔 **1 个点**」同样要 119–159ms、整页重画也不随墨增长（126/136/141ms）
 * ⇒ 那 ~140ms 的时间单位是**画布节点查询那一趟**（≈130ms），不是绘制量。
 * 数字与判读见记忆 `score-reader-draw-stall-data`（那份只记数据，别当方案读）。
 *
 * 所以这一层的意义是**结构**上的（把「变了什么」变成显式的量，让消费者按增量干活），
 * 而不是「它现在就能省下那 140ms」。
 *
 * ## 这一层现在做什么（第一片）
 *
 * 只服务**画布**这一个消费者，且只认一种增量：**「某一页末尾多了一笔」**（落笔的正常形态）。
 * 其余一切（撤销 / 清空 / 擦除 / 云端合入 / 换页 / 缩放…）一律 `resync` = 整份重画，与改动前
 * 行为完全一致。
 *
 * 两个设计选择，都是为了**可演化**：
 *
 * 1. **判据是纯函数**（本文件），不写在页面里 ⇒ 同样的语义以后可以直接被存盘、云同步、
 *    实时层复用（它们要的是同一件事：「这次变了什么」）。
 * 2. **增量从数据里推出来，不靠调用方声明**。让调用方传「我刚才加了一笔」是把正确性押在
 *    纪律上（§2-3 那份「同一个真相两份副本」的教训）；这里改成拿两份文档比对 ——
 *    **只比引用与长度、不扫点**，代价 O(页数 + 那一页的笔迹数)，认不出来就老实整份重画。
 *    换句话说：判错只会**多画一次**，永远不会少画。
 */

/** 三块已落定层各放着哪一页（`null` = 空着） */
export type LaneSlots = Record<Layer, number | null>

/**
 * 「位图是按什么画出来的」的快照。
 *
 * 它是那个**不变量**的载体：「每块批注画布的位图 == 它那一页在 `annos` 里的样子」。
 * 只要「画面世界」与这份快照一致，就说明位图还没过期 —— 于是新增的那一笔可以**补**上去，
 * 不必整份重画。
 *
 * ⚠️ 字段的取舍就是不变量的定义域：**凡是会改变位图该长什么样的输入都得在这里**，
 * 少一个就会出现「该重画却没重画」。当前工具（画笔/荧光笔/橡皮）**刻意不在其中** ——
 * 笔色、线宽、透明度都随笔迹存进了 `annos`，换工具不改变任何**已有**位图。想把它加回来的人，
 * 先回答一个问题：换工具为什么会改变已经画好的墨？
 */
export type InkWorld = {
  annos: AnnoDoc
  /** 文档代次（换册 / 重载会变） */
  docTick: number
  /** 当前页码（UD 模式下它跟着滚动位置走） */
  page: number
  /** 三块各放着哪一页 */
  slots: LaneSlots
  /** 视口的 CSS 尺寸（决定位图分辨率） */
  w: number
  h: number
  /** 批注态开着没有（批注层是按它挂载的，一挂一卸位图就没了） */
  penOn: boolean
  /** 双指手势结束计数：手势中不重画，结束时补一次 */
  gestureTick: number
}

/** 这次该做什么 */
export type InkUpdate =
  /** 什么都不用做（位图已经是对的） */
  | { kind: 'none' }
  /** 只把这一笔补到那一块上（O(这一笔)） */
  | { kind: 'append'; layer: Layer; stroke: AnnoStroke }
  /** 整份重画（换页 / 缩放 / 撤销 / 擦除 / 清空 / 云端合入 / 批注开关…） */
  | { kind: 'resync' }

/** 「画面世界」有没有动过（动过就必须整份重画，增量只在世界没动时才成立） */
function sameWorld(a: InkWorld, b: InkWorld): boolean {
  return (
    a.docTick === b.docTick &&
    a.page === b.page &&
    a.w === b.w &&
    a.h === b.h &&
    a.penOn === b.penOn &&
    a.gestureTick === b.gestureTick &&
    a.slots.a === b.slots.a &&
    a.slots.b === b.slots.b &&
    a.slots.c === b.slots.c
  )
}

/**
 * 两份文档「是不是同一份」（每个键的数组都是同一个引用）。
 *
 * ⚠️ 这是**便宜的**那份检查：O(页数) 次引用比较，一页的点一个都不扫。
 */
export function sameAnnoDoc(a: AnnoDoc, b: AnnoDoc): boolean {
  if (a === b) return true
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (a[k] !== b[k]) return false
  }
  return true
}

/**
 * 「这次是不是**恰好**在某一页末尾多加了一笔」——是就返回它，否则 `null`（= 认不出来）。
 *
 * 判据（全部是引用/长度比较，不扫点）：
 * - 只有**一页**的数组换了引用；
 * - 新数组长度 = 旧 + 1，且**前面每一笔都是同一个对象**（撤销 / 擦除 / 云端合入都会破坏这条）；
 * - 多出来的那一笔就是最后一个元素。
 *
 * ⚠️ 「这一页**原本不存在**」也算 0 → 1 的那种情况 —— 空白页落第一笔是最常见的形态
 *（`commitStrokePoints` 里 `before = annos[key] ?? []`），漏掉它等于把最该省的那一次让出去。
 * 反过来「整页没了」不是增量。
 *
 * 认不出来 ⇒ 调用方整份重画。**这个函数永远不会漏掉一个真实变更**（它只说"像不像增量"，
 * 说不像时由更保守的路径兜底）。
 */
export function singleStrokeAdded(
  prev: AnnoDoc,
  next: AnnoDoc
): { page: number; stroke: AnnoStroke } | null {
  if (prev === next) return null
  let hit: { page: number; stroke: AnnoStroke } | null = null
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  for (const k of keys) {
    const a = prev[k]
    const b = next[k]
    if (a === b) continue // 这一页没动
    if (!b) return null // 整页没了：不是「多一笔」
    const prevLen = a ? a.length : 0
    if (b.length !== prevLen + 1) return null
    for (let i = 0; i < prevLen; i += 1) {
      if (a?.[i] !== b[i]) return null // 前面有变（撤销 / 擦除 / 云端合入那一类）
    }
    if (hit) return null // 不止一页变了
    hit = { page: Number(k), stroke: b[b.length - 1] }
  }
  return hit
}

/**
 * **这次该做什么** —— 画布这一侧的唯一判据（纯函数，用例见 `anno-changes.test.ts`）。
 *
 * `prev` 是「位图当前是按哪份世界画出来的」（没画过就传 `null`）。
 */
export function inkUpdateFor(prev: InkWorld | null, now: InkWorld): InkUpdate {
  if (!prev) return { kind: 'resync' }
  if (!sameWorld(prev, now)) return { kind: 'resync' }
  const added = singleStrokeAdded(prev.annos, now.annos)
  if (!added) {
    // 认不出来：同一份就什么都不用做，否则整份重画
    return sameAnnoDoc(prev.annos, now.annos) ? { kind: 'none' } : { kind: 'resync' }
  }
  // 这一页此刻不在任何一块上 ⇒ 位图里本来就没有它，没什么可补的
  //（等它被摆上来时会走 resync：`slots` 变了）
  const layer = ALL_LAYERS.find((l) => now.slots[l] === added.page)
  return layer ? { kind: 'append', layer, stroke: added.stroke } : { kind: 'none' }
}
