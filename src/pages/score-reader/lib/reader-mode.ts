import Taro from '@tarojs/taro'

/**
 * 翻页模式：
 * - `lr`：左右翻页（一屏一页，横滑翻页）——默认；
 * - `ud`：上下滚动（所有页竖着连成一条，中间 60% 是菜单区，上下 20% 点一下滚一页）。
 *
 * 记住用户的选择：读谱是件连续的事，模式属于「这个人的习惯」，不该每次进来重选。
 */
export type ReaderMode = 'lr' | 'ud'

const MODE_KEY = 'score-reader-mode'

export function loadReaderMode(): ReaderMode {
  try {
    const raw = Taro.getStorageSync(MODE_KEY)
    return raw === 'ud' ? 'ud' : 'lr'
  } catch {
    // 读不到不是错误（从未写过 / 存储不可用）——按默认的左右模式
    return 'lr'
  }
}

export function saveReaderMode(mode: ReaderMode): void {
  try {
    Taro.setStorageSync(MODE_KEY, mode)
  } catch {
    // 存不下只影响下次进来的默认值，不该影响这次切换
  }
}
