import Taro from '@tarojs/taro'
import { createSeenStore } from './createSeenStore'

// 已读标记 + tabBar 红点 flag：createSeenStore 工厂实例（P2-4 合一，API 与原实现一致）
const store = createSeenStore('postSeen_')

/** 该公告是否已被用户查看过（localStorage，按设备；打开详情页即标记） */
export const isPostSeen = store.isSeen
export const markPostSeen = store.markSeen
/** 已查看变化事件：供公告列表重算「未查看」红气泡 */
export const subscribePostSeen = store.subscribeSeen
export const setPostUnviewedFlag = store.setUnviewedFlag
export const getPostUnviewedFlag = store.getUnviewedFlag
export const subscribePostUnviewed = store.subscribeUnviewedFlag

// ---- 社区红点「点击即消」模型 ----
// 三处红点（底边栏 / 重奏 / 团建）各自记录「最近一次点击消除」的时间戳：
// 点亮 ⇔ 该范围最新公告 created_at 晚于消除时间；新公告到达自然重新点亮。
// 缺省（从未点击过）按 0 处理——有内容即亮，属经典徽标行为；
// 点击后写入当下时刻，此后仅更新的公告会再次点亮。
export type CommunityDotScope = 'bar' | 'ensemble' | 'gathering'

const DISMISS_KEYS: Record<CommunityDotScope, string> = {
  bar: 'communityBarDismissedAt',
  ensemble: 'communityEnsembleDismissedAt',
  gathering: 'communityGatheringDismissedAt',
}

/** 读取某处红点的消除时间；从未写过返回 0（视为从未消除，有内容即亮） */
export function getCommunityDismissedAt(scope: CommunityDotScope): number {
  try {
    const v = Taro.getStorageSync(DISMISS_KEYS[scope])
    return typeof v === 'number' && v > 0 ? v : 0
  } catch {
    return 0
  }
}

/** 点击消除：写入当前时刻并广播（底边栏同步组件与页面徽标即时重算） */
export function dismissCommunityDot(scope: CommunityDotScope): void {
  try {
    Taro.setStorageSync(DISMISS_KEYS[scope], Date.now())
  } catch {
    /* ignore quota / unsupported */
  }
  store.notify()
}

/** 纯函数：红点是否点亮（范围内最新公告时间戳严格晚于消除时间戳） */
export function isCommunityDotOn(
  latestMs: number | null | undefined,
  dismissedMs: number | null | undefined
): boolean {
  return latestMs != null && dismissedMs != null && latestMs > dismissedMs
}
