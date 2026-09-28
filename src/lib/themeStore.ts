import { createStore, useStore } from './createStore'
import { readStoredThemeSync, resolveTheme, type ThemeMode } from './theme'

// 模块级外部 store：当前主题模式（light/dark）。
// custom tabBar 不继承 <App> 的 theme-context（Taro 已知限制），故主题走模块级 store，
// 由 ThemeProvider 在 mode 变化时推送，custom tabBar 订阅后自己挂 .dark 类。
// 初始值同步解析存储偏好：冷启动首帧早于 ThemeProvider 挂载推送。
const store = createStore<ThemeMode>(resolveTheme(readStoredThemeSync()))

/** 由 ThemeProvider 推送当前生效模式 */
export function setThemeMode(next: ThemeMode) {
  store.set(next)
}

export function getThemeMode(): ThemeMode {
  return store.get()
}

export function subscribeThemeMode(cb: () => void): () => void {
  return store.subscribe(cb)
}

export function useThemeMode(): ThemeMode {
  return useStore(store)
}
