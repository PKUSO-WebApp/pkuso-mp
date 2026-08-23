import { useSyncExternalStore } from 'react'

// 全局「覆盖层（Modal）是否打开」计数。custom tabBar 与页面 Modal 处于不同渲染子树，
// 仅靠 z-index 无法让 Modal 盖住 tabBar（页面内容被压在更低层叠上下文），
// 因此用模块级 store 通信：Modal 打开时 tabBar 隐藏自身，确保弹窗始终在上。
let overlayCount = 0
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

export function setOverlayOpen(open: boolean) {
  overlayCount = Math.max(0, overlayCount + (open ? 1 : -1))
  emit()
}

export function getOverlayOpen() {
  return overlayCount > 0
}

export function subscribeOverlayOpen(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useOverlayOpen() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    getOverlayOpen,
    getOverlayOpen
  )
}
