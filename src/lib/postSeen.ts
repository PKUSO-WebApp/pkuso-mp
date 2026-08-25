import Taro from '@tarojs/taro'

const SEEN_PREFIX = 'postSeen_'

/** 该公告是否已被用户查看过（localStorage，按设备；打开详情页即标记） */
export function isPostSeen(id: string): boolean {
  try {
    return Taro.getStorageSync(SEEN_PREFIX + id) === true
  } catch {
    return false
  }
}

export function markPostSeen(id: string): void {
  try {
    Taro.setStorageSync(SEEN_PREFIX + id, true)
  } catch {
    /* ignore quota / unsupported */
  }
  notifySeenChanged()
}

// 已查看变化事件：供公告列表重算「未查看」红气泡
const seenListeners = new Set<() => void>()
function notifySeenChanged() {
  seenListeners.forEach((l) => l())
}
export function subscribePostSeen(cb: () => void): () => void {
  seenListeners.add(cb)
  return () => {
    seenListeners.delete(cb)
  }
}

// 社区 tabBar 红点 store（模块级，custom tabBar 订阅渲染，与 rehearsalSeen 同源模式）
let hasUnviewed = false
const flagListeners = new Set<() => void>()
export function setPostUnviewedFlag(v: boolean): void {
  const next = !!v
  if (next === hasUnviewed) return
  hasUnviewed = next
  flagListeners.forEach((l) => l())
}
export function getPostUnviewedFlag(): boolean {
  return hasUnviewed
}
export function subscribePostUnviewed(cb: () => void): () => void {
  flagListeners.add(cb)
  return () => {
    flagListeners.delete(cb)
  }
}

// ---- 社区红点「点击即消」模型 ----
// 三处红点（底边栏 / 重奏 / 团建）各自记录「最近一次点击消除」的时间戳：
// 点亮 ⇔ 该范围最新公告 created_at 晚于消除时间；新公告到达自然重新点亮。
// 缺省（从未点击过）按 0 处理——有内容即亮，属经典徽标行为；
// 点击后写入当下时刻，此后仅更新的公告会再次点亮。
export type CommunityDotScope = 'bar' | 'ensemble' | 'gathering'

const DISMISS_KEYS: Record<CommunityDotScope, string> = {
  bar: 'communityBarDismissedAt',
  ensemble: 'communityEnsembleDismissedAt',
  gathering: 'communityGatheringDismissedAt',
}

/** 读取某处红点的消除时间；从未写过返回 0（视为从未消除，有内容即亮） */
export function getCommunityDismissedAt(scope: CommunityDotScope): number {
  try {
    const v = Taro.getStorageSync(DISMISS_KEYS[scope])
    return typeof v === 'number' && v > 0 ? v : 0
  } catch {
    return 0
  }
}

/** 点击消除：写入当前时刻并广播（底边栏同步组件与页面徽标即时重算） */
export function dismissCommunityDot(scope: CommunityDotScope): void {
  try {
    Taro.setStorageSync(DISMISS_KEYS[scope], Date.now())
  } catch {
    /* ignore quota / unsupported */
  }
  notifySeenChanged()
}

/** 纯函数：红点是否点亮（范围内最新公告时间戳严格晚于消除时间戳） */
export function isCommunityDotOn(
  latestMs: number | null | undefined,
  dismissedMs: number | null | undefined
): boolean {
  return latestMs != null && dismissedMs != null && latestMs > dismissedMs
}
