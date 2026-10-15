import Taro from '@tarojs/taro'

/**
 * 批注工具条「收起」状态（全设备记住）。
 *
 * **为什么要有这个开关**（用户 2026-10-16 报）：工具条是**独立浮层**，手指落在它上面时
 * 触摸**到不了画布** —— 被它盖住的那一条既看不到、也**起不了笔**。所以「半透明」与
 * 「落笔时让位」这类做法只能解决「看到」，只有**真的把它收起来**才能在里面落笔。
 * 走的是**用户自己控制**的收起（不做自动让位：那要在每一笔上动显示）。
 *
 * key 带版本号，与 `tutorial-seen.ts` 同形：将来收起形态大改时可以推一格重置。
 * 读失败 / 读到别的值一律当「没收起」——宁可多显示一次工具条，也别让人找不到工具。
 * 写失败静默（下次进来还是展开的，不是错误）。
 */
export const PEN_BAR_COLLAPSED_KEY = 'score-reader-pen-bar-collapsed:v1'

export function isPenBarCollapsed(): boolean {
  try {
    return Taro.getStorageSync(PEN_BAR_COLLAPSED_KEY) === true
  } catch {
    return false
  }
}

export function setPenBarCollapsed(collapsed: boolean): void {
  try {
    Taro.setStorageSync(PEN_BAR_COLLAPSED_KEY, collapsed)
  } catch {
    /* ignore quota / unsupported */
  }
}
