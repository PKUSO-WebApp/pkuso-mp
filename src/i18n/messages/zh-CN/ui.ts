export const ui = {
  adminBlocked: {
    title: '不提供小程序管理端，请使用网页端',
    desc: '小程序仅面向乐团成员；审批、排练管理、考勤统计等管理功能请使用网页端。',
    logout: '退出登录',
    loggingOut: '退出中…',
  },
  staffBlocked: {
    title: '本账号不提供小程序端，请使用网页端',
    desc: '小程序仅面向乐团成员；谱务等专职账号的功能在网页端。',
    logout: '退出登录',
    loggingOut: '退出中…',
  },
  // 多设备模型下「被别的设备顶下线」不存在了：这条通知只剩一种含义 ——
  // 本设备被设为「不信任」（在线被踢，或登录/冷启动被服务端拒绝）
  forceOffline: {
    title: '该设备已被拒绝登录',
    line1: '这台设备已被设为「不信任」，已下线；在恢复信任之前，它无法重新登录。',
    line2: '如果这不是你本人的操作，请在另一台设备上打开「我的 - 登录设备」查看。',
    // 这个按钮只是**关掉弹窗**（onClose = clearForcedOffline），不做任何登录动作 ——
    // 从前叫「重新登录」是在承诺一个不存在的能力（用户 2026-10-10 指出）
    confirm: '好的',
  },
  errorBoundary: {
    defaultMessage: '渲染时发生错误',
  },
  modal: {
    close: '关闭',
  },
  tabBar: {
    home: '首页',
    community: '社区',
    schedule: 'B108',
    score: '乐谱',
    members: '成员',
    profile: '我的',
  },
}
