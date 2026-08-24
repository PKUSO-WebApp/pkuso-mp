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
