// 模块级外部 store：自定义 tabBar 的「我的」未读红点。
// custom tabBar 不继承 <App> 的 React Context（Taro 已知限制，组件由框架单独挂载），
// 故红点数据走模块级 store 而非 Context，custom tabBar 订阅渲染。
import { useSyncExternalStore } from 'react'

let unread = 0
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

/** 写入「我的」未读数（<=0 视为无红点） */
export function setTabBarUnread(n: number) {
  const next = Math.max(0, Math.floor(n || 0))
  if (next === unread) return
  unread = next
  emit()
}

export function getTabBarUnread(): number {
  return unread
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function subscribeTabBarUnread(cb: () => void) {
  return subscribe(cb)
}

export function useTabBarUnread(): number {
  return useSyncExternalStore(subscribe, getTabBarUnread, getTabBarUnread)
}
