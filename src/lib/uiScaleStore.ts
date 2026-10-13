import { createStore, useStore } from './createStore'
import { readStoredUiScale, type UiScale } from './ui-scale'

/**
 * 模块级外部 store：当前「显示大小」档位。
 *
 * 与 `themeStore` 同一个理由：**custom tabBar 不继承 `<App>` 的 Context**（Taro 已知限制），
 * 而底边栏的高度/图标/字号是内联 px（不随屏宽变），必须跟着档位走 —— 所以它只能靠
 * 「模块级状态 + 订阅」拿到档位，由 UiScaleProvider 在变化时推送。
 * 初始值同步解析存储偏好：冷启动首帧早于 Provider 挂载推送。
 */
const store = createStore<UiScale>(readStoredUiScale())

/** 由 UiScaleProvider 推送当前档位 */
export function setUiScale(next: UiScale): void {
  store.set(next)
}

export function getUiScale(): UiScale {
  return store.get()
}

export function subscribeUiScale(cb: () => void): () => void {
  return store.subscribe(cb)
}

export function useUiScaleStore(): UiScale {
  return useStore(store)
}
