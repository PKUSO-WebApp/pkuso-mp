import { createSeenStore } from './createSeenStore'

// 已读标记 + 首页 tabBar 红点 flag：createSeenStore 工厂实例（P2-4 合一，API 与原实现一致）
const store = createSeenStore('rehearsalSeen_')

/** 该排练是否已被用户查看过（localStorage，按设备；打开详情页即标记） */
export const isRehearsalSeen = store.isSeen
export const markRehearsalSeen = store.markSeen
/** 已查看变化事件：供首页重算「未查看」红点 */
export const subscribeRehearsalSeen = store.subscribeSeen
export const setRehearsalUnviewedFlag = store.setUnviewedFlag
export const getRehearsalUnviewedFlag = store.getUnviewedFlag
export const subscribeRehearsalUnviewed = store.subscribeUnviewedFlag
