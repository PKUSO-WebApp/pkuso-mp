import { useSyncExternalStore } from 'react'

/**
 * 模块级外部 store 工厂（与 `createSeenStore` 同属 P2-4 那批收敛）。
 *
 * 为什么这些状态要放在模块级而不是 React Context：custom tabBar 由框架单独挂载，
 * 不继承 `<App>` 的 Context（Taro 已知限制），于是登录态 / 主题 / 红点 / 遮罩计数
 * 都只能靠「模块级状态 + 订阅」通信。
 *
 * 本次收敛前，这套「值 + Set<listener> + emit + 相等判断」被手抄了 5 份
 * （tabBarSelected / tabBarBadge / overlayStore / themeStore / authStore），
 * 语义还有出入：有的 set 前判等、有的不判（每次都广播，订阅方白重渲染），
 * 有的把 subscribe 闭包写在组件里（每次渲染换引用，`useSyncExternalStore`
 * 会跟着反复退订/重订）。合一后统一为下面的语义。
 *
 * 用法：
 * ```ts
 * const store = createStore(0)          // 模块级，模块内私有
 *
 * export function setX(n: number) { store.set(n) }
 * export function getX() { return store.get() }
 * export function subscribeX(cb: () => void) { return store.subscribe(cb) }
 * ```
 * 组件里订阅用 `useStore(store)`；class 组件（CustomTabBar）用 `get` + `subscribe`。
 */
export type Store<T> = {
  /** 读当前值 */
  get: () => T
  /** 写值：与当前值相等（Object.is）时不广播 */
  set: (next: T) => void
  /** 订阅变化，返回退订函数 */
  subscribe: (cb: () => void) => () => void
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<() => void>()

  return {
    get: () => value,
    set: (next: T) => {
      if (Object.is(value, next)) return
      value = next
      listeners.forEach((l) => l())
    },
    subscribe: (cb: () => void) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
  }
}

/**
 * 在组件里订阅 store。`get` / `subscribe` 是工厂返回对象上的稳定方法引用，
 * 所以不会每次渲染都退订重订。
 */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
