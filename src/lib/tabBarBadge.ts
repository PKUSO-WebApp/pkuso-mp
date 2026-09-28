import { createStore, useStore } from './createStore'

// 模块级外部 store：自定义 tabBar 的「我的」未读红点。
// custom tabBar 不继承 <App> 的 React Context（Taro 已知限制，组件由框架单独挂载），
// 故红点数据走模块级 store 而非 Context，custom tabBar 订阅渲染。
const store = createStore(0)

/** 写入「我的」未读数（<=0 视为无红点） */
export function setTabBarUnread(n: number) {
  store.set(Math.max(0, Math.floor(n || 0)))
}

export function getTabBarUnread(): number {
  return store.get()
}

export function subscribeTabBarUnread(cb: () => void): () => void {
  return store.subscribe(cb)
}

export function useTabBarUnread(): number {
  return useStore(store)
}
