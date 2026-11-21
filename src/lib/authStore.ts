import { createStore } from './createStore'
import { hasStoredAuthSession } from './auth-storage'

// 模块级外部 store：当前登录状态（单一事实来源）。
// CustomTabBar 是 class 组件，无法使用 hooks，需要通过此 store 获取登录状态。
//
// 初值取「本机是否存有会话」：冷启动时 UserProvider 还没恢复完，若一律 false，
// 回访用户在这一小段时间里点「我的」会被当成游客送去登录页。真正的会话真伪仍由
// UserProvider 的 applySession / SIGNED_OUT 事件改写。
const store = createStore(hasStoredAuthSession())

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
