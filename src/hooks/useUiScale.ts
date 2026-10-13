import { useCallback } from 'react'
import { uiScaleFactor, uiScaleClass, writeUiScale, type UiScale } from '@/lib/ui-scale'
import { setUiScale as pushUiScale, useUiScaleStore } from '@/lib/uiScaleStore'

/**
 * 显示大小的**读取入口**（没有 Provider —— 见下）。
 *
 * 为什么不用 React Context：这份状态的使用者跨三处彼此够不着的树 ——
 * 页面里的组件、**框架独立槽位的 custom tabBar**（不继承 `<App>` 的 Context，Taro 已知限制）、
 * 以及页面根上那个类名（`useThemeClass()`）。Context 只能覆盖第一处，于是另外两处还得靠
 * 模块级 store，等于同一份状态两个来源 —— 一定会漂。
 *
 * 所以唯一真相就是 `lib/uiScaleStore`（模块级、可订阅、初值直接来自存储），
 * 这里只是把它包成 hook：
 * - `useUiScale()`：当前档位 + 切换（写入即持久化）；
 * - `useUiScaleFactor()`：档位系数，乘在**内联 px** 的绝对尺寸上（口径见 lib/ui-scale.ts）。
 *
 * 没有 Provider 也就不存在「忘了包 Provider 就抛错」这回事（曾经的版本会抛，
 * 一加就炸了 20 条既有测试 —— 而它们与这个功能毫无关系）。
 */
export type UiScaleContextValue = {
  preference: UiScale
  setPreference: (v: UiScale) => void
  /** 档位系数（绝对 px 用它；rpx 那几个 token 由 CSS 自己算，含设备系数） */
  factor: number
}

export function useUiScaleContext(): UiScaleContextValue {
  const preference = useUiScaleStore()
  const setPreference = useCallback((value: UiScale) => {
    // 模块级 store 是唯一真相：写它就等于全站（含 tabBar 槽位）跟着变
    pushUiScale(value)
    void writeUiScale(value)
  }, [])
  return { preference, setPreference, factor: uiScaleFactor(preference) }
}

/**
 * 档位系数：把**内联 px** 的绝对尺寸乘上它。
 * rpx 那一层不用这个 hook（它在 CSS 里由 `--ui-dev` × `--ui-k` 算）。
 */
export function useUiScaleFactor(): number {
  return uiScaleFactor(useUiScaleStore())
}

/** 页根该挂的类（由 `useThemeClass()` 合成，一般不用直接调） */
export function useUiScaleClass(): string {
  return uiScaleClass(useUiScaleStore())
}
