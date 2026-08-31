// 模块级外部 store：当前主题模式（light/dark）。
// custom tabBar 不继承 <App> 的 theme-context（Taro 已知限制），故主题走模块级 store，
// 由 ThemeProvider 在 mode 变化时推送，custom tabBar 订阅后自己挂 .dark 类。
import { useSyncExternalStore } from 'react'
import { readStoredThemeSync, resolveTheme, type ThemeMode } from './theme'

// 初始值同步解析存储偏好：冷启动首帧（早于 ThemeProvider 挂载推送）
function initialMode(): ThemeMode {
  return resolveTheme(readStoredThemeSync())
}

let mode: ThemeMode = initialMode()
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

/** 由 ThemeProvider 推送当前生效模式 */
export function setThemeMode(next: ThemeMode) {
  if (next === mode) return
  mode = next
  emit()
}

export function getThemeMode(): ThemeMode {
  return mode
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function subscribeThemeMode(cb: () => void) {
  return subscribe(cb)
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, getThemeMode, getThemeMode)
}
