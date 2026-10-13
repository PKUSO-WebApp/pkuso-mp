export const devices = {
  navTitle: '登录设备',
  title: '登录设备',
  subtitle:
    '这是你的账号已登录的设备。被设为「不信任」的设备会立即下线，并且在你恢复信任之前无法重新登录；删除的设备会从列表消失，下次登录时会被当作新设备。',
  selfTag: '本机',
  untrustedTag: '已拒绝登录',
  lastSeen: '最近活跃：{time}',
  untrust: '设为不信任',
  trust: '恢复信任',
  untrustConfirmTitle: '设为不信任',
  untrustConfirmContent: '这台设备会立即下线，并且在你恢复信任之前无法重新登录。确定吗？',
  deleteDevice: '删除设备',
  deleteConfirmTitle: '删除设备',
  // 二次确认必须写清后果：这台设备会怎样（下线 + 消失）、以及之后会发生什么（当新设备 + 通知）
  deleteConfirmContent:
    '这台设备会立即下线，并从列表中消失。它下次登录时会被当作新设备，你也会收到一条「新设备登录」通知。',
  deleteSuccess: '设备已删除',
  deleteFailed: '删除失败，请重试',
  empty: '暂无登录设备',
  loadFailed: '加载失败，请重试',
  actionFailed: '操作失败，请重试',
}
