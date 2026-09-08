// 模块级外部 store：当前登录状态（单一事实来源）。
// CustomTabBar 是 class 组件，无法使用 hooks，需要通过此 store 获取登录状态。
let isLoggedIn = false
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

/** 设置登录状态（UserProvider 在 session 变化时调用） */
export function setLoggedIn(value: boolean) {
  if (isLoggedIn === value) return
  isLoggedIn = value
  emit()
}

/** 获取当前登录状态 */
export function getLoggedIn(): boolean {
  return isLoggedIn
}

/** 订阅登录状态变化 */
export function subscribeLoggedIn(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
