export const notification = {
  activityTitle: '活动通知',
  activityNavTitle: '活动通知',
  activityTabs: { all: '全部', ensemble: '重奏', gathering: '团建' },
  systemTitle: '系统通知',
  systemNavTitle: '系统通知',
  systemTabs: { unread: '未读', read: '已读', unreadCount: '未读({n})' },
  /**
   * 服务端通知的文案，按 `notifications.kind` 认（渲染在 `lib/notification-text.ts`）。
   *
   * ⚠️ 与 `title` / `content` 那两列的关系：那两列是**中文兜底**（服务端拼的），
   * 认不得的 kind 照样原样显示它们 —— 所以这里加新 key **不必**同时改服务端。
   */
  kind: {
    deviceLogin: {
      title: '新设备登录',
      body: '{name} 于 {time} 登录了你的账号',
      unknownDevice: '未知设备',
    },
  },
  operationFailed: '操作失败，请稍后重试',
  markRead: '标记已读',
  emptyUnread: '暂无未读通知',
  list: {
    failed: '加载失败，请稍后重试',
    empty: '暂无消息',
  },
}
