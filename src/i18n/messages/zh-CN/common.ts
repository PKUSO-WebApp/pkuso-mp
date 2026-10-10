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
  /**
   * 「保存到…」：把文件交给用户能看见的地方。**共用组件**（阅读器顶栏 + 声部页文件行），
   * 所以放在 common 而不是某一页的命名空间里。落点与平台能力见 src/lib/pdf-handoff.ts。
   */
  saveTo: {
    title: '保存到…',
    favorites: '收藏到微信',
    chat: '发送到…',
    app: '用其他应用打开',
    disk: '保存到电脑',
    preparing: '正在准备文件…',
    cancel: '取消',
    notReady: '文件尚未加载完成',
    failed: '保存失败：{error}',
  },
  error: {
    defaultTitle: '页面出错了',
    copySuccess: '已复制错误信息',
    copyFailed: '复制失败',
    copyTruncated: '已复制（内容过长，已截断）',
    copyButton: '复制错误信息',
    hint: '请把复制的信息发送给乐团管理员，以便尽快修复问题。',
  },
  errors: {
    loadFailed: '数据加载失败，请重试',
    saveFailed: '操作失败，请重试',
    // 断网时跳转会超时失败（issue #7）。跳转失败与「页面崩了」是两回事——用户还在
    // 原来那一屏、应用也是好的，所以给轻提示让他重试，而不是把他扔到整页错误屏。
    navigateFailed: '页面打开失败，请重试',
  },
  agreement: {
    checkbox: '我已阅读并同意',
    linkText: '用户协议',
    requiredToast: '请先同意用户协议',
    navTitle: '用户协议',
  },
  guestHint: '请在「我的」页面登录以查看',
  hidden: '（被隐藏）',
  notFilled: '未填写',
  joinDate: {
    tpl: '{year}{season}',
    season: {
      spring: '春',
      fall: '秋',
    },
  },
  languageToggle: {
    zh: '中',
    en: 'En',
  },
  attendance: {
    notSignedIn: '未签到',
  },
  version: {
    release: '正式版',
    trial: '体验版',
    develop: '开发版',
  },
  upload: {
    unknownFormat: '未知数据格式',
    readFailed: '读取本地附件失败',
    readFailedUnknown: '读取本地附件失败：未知数据格式',
    attachmentReadFailed: '附件读取失败',
  },
}
