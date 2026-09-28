import { createStore, useStore } from './createStore'

// 全局「覆盖层（Modal）是否打开」。custom tabBar 与页面 Modal 处于不同渲染子树，
// 仅靠 z-index 无法让 Modal 盖住 tabBar（页面内容被压在更低层叠上下文），
// 因此用模块级 store 通信：Modal 打开时 tabBar 隐藏自身，确保弹窗始终在上。
//
// 内部按 count 计数（Modal 可以嵌套），对外只暴露「有没有打开的」。计数放在
// 模块变量、store 里存派生的布尔值——这样判等发生在布尔上：多开一层 Modal 时
// 布尔没变，订阅方不会被白重渲染（收敛前每次 setOverlayOpen 都会广播一遍）。
let overlayCount = 0
const store = createStore(false)

export function setOverlayOpen(open: boolean) {
  overlayCount = Math.max(0, overlayCount + (open ? 1 : -1))
  store.set(overlayCount > 0)
}

export function getOverlayOpen() {
  return store.get()
}

export function subscribeOverlayOpen(cb: () => void): () => void {
  return store.subscribe(cb)
}

export function useOverlayOpen() {
  return useStore(store)
}
