// 公共文案（跨页面复用：按钮、加载态等）
export const common = {
  appName: '北京大学学生交响乐团',
  actions: {
    save: '保存',
    cancel: '取消',
    confirm: '确定',
    openSettings: '去设置',
    delete: '删除',
    edit: '编辑',
    lock: '锁定',
    unlock: '解锁',
    loading: '加载中…',
    retry: '重试',
    submit: '提交',
  },
  fields: {
    email: '邮箱',
    password: '密码',
    confirmPassword: '确认密码',
    fullName: '姓名',
  },
  approval: {
    pending: {
      title: '等待管理员审核',
      desc: '资料已提交，管理员审核通过后即可使用小程序。',
    },
    rejected: {
      title: '审核未通过，请联系管理员',
      desc: '如有疑问请联系乐团管理员。',
    },
    refresh: '刷新状态',
    checking: '检查中…',
    logout: '退出登录',
    exiting: '退出中…',
    loading: '加载中…',
  },
  error: {
    defaultTitle: '页面出错了',
    copySuccess: '已复制错误信息',
    copyFailed: '复制失败',
    copyButton: '复制错误信息',
    hint: '请把复制的信息发送给乐团管理员，以便尽快修复问题。',
  },
  errors: {
    loadFailed: '数据加载失败，请重试',
    saveFailed: '操作失败，请重试',
  },
  hidden: '（被隐藏）',
  notFilled: '未填写',
  joinDate: {
    tpl: '{year}{season}',
    season: {
      spring: '春',
      fall: '秋',
    },
  },
}
