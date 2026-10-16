export const notification = {
  activityTitle: 'Activity Notifications',
  activityNavTitle: 'Activity Notifications',
  activityTabs: { all: 'All', ensemble: 'Ensemble', gathering: 'Activity' },
  systemTitle: 'System Notifications',
  systemNavTitle: 'System Notifications',
  systemTabs: { unread: 'Unread', read: 'Read', unreadCount: 'Unread ({n})' },
  kind: {
    deviceLogin: {
      title: 'New device sign-in',
      body: '{name} signed in to your account at {time}',
      unknownDevice: 'Unknown device',
    },
  },
  operationFailed: 'Operation failed, please retry',
  markRead: 'Mark as Read',
  emptyUnread: 'No unread notifications',
  list: {
    failed: 'Failed to load, please retry',
    empty: 'No messages',
  },
}
