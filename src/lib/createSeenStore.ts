import Taro from '@tarojs/taro'

/**
 * 已读标记 + 未查看红点 flag 的模块级 store 工厂（P2-4）。
 * postSeen / rehearsalSeen 原为两份同源复制实现，此处合一：
 * - 已读：按 id 写 storage（打开详情页即标），变更时广播给列表重算红气泡；
 * - 未查看 flag：模块级布尔 + 订阅（custom tabBar 红点渲染用）。
 */
export function createSeenStore(storagePrefix: string) {
  // 已查看变化事件监听
  const seenListeners = new Set<() => void>()
  function notify() {
    seenListeners.forEach((l) => l())
  }

  /** 该条目是否已被用户查看过（localStorage，按设备；打开详情页即标记） */
  function isSeen(id: string | number): boolean {
    try {
      return Taro.getStorageSync(storagePrefix + id) === true
    } catch {
      return false
    }
  }

  function markSeen(id: string | number): void {
    try {
      Taro.setStorageSync(storagePrefix + id, true)
    } catch {
      /* ignore quota / unsupported */
    }
    notify()
  }

  function subscribeSeen(cb: () => void): () => void {
    seenListeners.add(cb)
    return () => {
      seenListeners.delete(cb)
    }
  }

  // 未查看红点 flag store（模块级，custom tabBar 订阅渲染）
  let hasUnviewed = false
  const flagListeners = new Set<() => void>()
  function setUnviewedFlag(v: boolean): void {
    const next = !!v
    if (next === hasUnviewed) return
    hasUnviewed = next
    flagListeners.forEach((l) => l())
  }
  function getUnviewedFlag(): boolean {
    return hasUnviewed
  }
  function subscribeUnviewedFlag(cb: () => void): () => void {
    flagListeners.add(cb)
    return () => {
      flagListeners.delete(cb)
    }
  }

  return {
    isSeen,
    markSeen,
    subscribeSeen,
    /** 手动触发已读变化广播（如社区红点「点击即消」写完时间戳后复用同一广播通道） */
    notify,
    setUnviewedFlag,
    getUnviewedFlag,
    subscribeUnviewedFlag,
  }
}
