import Taro from '@tarojs/taro'

/**
 * 阅读器教程「已看过」标记（全设备一次）。
 *
 * key 带版本号：将来教程内容大改（多了新的手势/入口）时把版本推一格，就能让所有
 * 人再看一次新教程——这也是不用 `src/lib/createSeenStore.ts` 的原因，那是
 * 「按 id 已读 + 订阅广播 + 未读红点 flag」三合一，这里只需要一个全局布尔。
 *
 * 读失败一律当「没看过」（宁可多展示一次）；写失败静默（下次再展示，不是错误）。
 */
export const TUTORIAL_SEEN_KEY = 'score-reader-tutorial-seen:v1'

export function hasSeenReaderTutorial(): boolean {
  try {
    return Taro.getStorageSync(TUTORIAL_SEEN_KEY) === true
  } catch {
    return false
  }
}

export function markReaderTutorialSeen(): void {
  try {
    Taro.setStorageSync(TUTORIAL_SEEN_KEY, true)
  } catch {
    /* ignore quota / unsupported */
  }
}
