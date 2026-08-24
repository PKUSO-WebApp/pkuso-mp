import Taro from '@tarojs/taro'

const SEEN_PREFIX = 'rehearsalSeen_'

/** 该排练是否已被用户查看过（localStorage，按设备；打开详情页即标记） */
export function isRehearsalSeen(id: number): boolean {
  try {
    return Taro.getStorageSync(SEEN_PREFIX + id) === true
  } catch {
    return false
  }
}

export function markRehearsalSeen(id: number): void {
  try {
    Taro.setStorageSync(SEEN_PREFIX + id, true)
  } catch {
    /* ignore quota / unsupported */
  }
  notifySeenChanged()
}

// 已查看变化事件：供首页重算「未查看」红点
const seenListeners = new Set<() => void>()
function notifySeenChanged() {
  seenListeners.forEach((l) => l())
}
export function subscribeRehearsalSeen(cb: () => void): () => void {
  seenListeners.add(cb)
  return () => {
    seenListeners.delete(cb)
  }
}

// 首页 tabBar 红点 store（模块级，custom tabBar 订阅渲染，与 tabBarBadge 同源模式）
let hasUnviewed = false
const flagListeners = new Set<() => void>()
export function setRehearsalUnviewedFlag(v: boolean): void {
  const next = !!v
  if (next === hasUnviewed) return
  hasUnviewed = next
  flagListeners.forEach((l) => l())
}
export function getRehearsalUnviewedFlag(): boolean {
  return hasUnviewed
}
export function subscribeRehearsalUnviewed(cb: () => void): () => void {
  flagListeners.add(cb)
  return () => {
    flagListeners.delete(cb)
  }
}
