import { createStore } from './createStore'

// 模块级外部 store：当前登录状态（单一事实来源）。
// CustomTabBar 是 class 组件，无法使用 hooks，需要通过此 store 获取登录状态。
const store = createStore(false)

/** 设置登录状态（UserProvider 在 session 变化时调用） */
export function setLoggedIn(value: boolean) {
  store.set(value)
}

/** 获取当前登录状态 */
export function getLoggedIn(): boolean {
  return store.get()
}

/** 订阅登录状态变化 */
export function subscribeLoggedIn(cb: () => void): () => void {
  return store.subscribe(cb)
}
