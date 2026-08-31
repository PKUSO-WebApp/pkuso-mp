// 我的页文案（按页分：profile）
export const profile = {
  title: '我的',
  settings: {
    attendance: '考勤',
    myActivities: '我的活动',
    appearance: '外观',
    account: '邮箱与密码',
    feedback: '问题与反馈',
    language: '语言设置',
    logout: '退出登录',
  },
  language: {
    title: '语言',
    zhCN: '中文',
    en: 'English',
  },
  // 分组标题
  sections: {
    notifications: '通知',
    settings: '设置',
  },
  // 通知信箱分类
  notifications: {
    attendance: '考勤与请假',
    activity: '活动',
    system: '系统',
  },
  // 头像卡字段前缀
  card: {
    instrument: '声部 {instrument}',
    email: '邮箱 {email}',
  },
  // 通用
  common: {
    notFilled: '未填写',
  },
  // 邮箱与密码弹窗
  account: {
    tabPassword: '修改密码',
    tabEmail: '换绑邮箱',
    newPassword: '新密码',
    newPasswordPlaceholder: '至少 6 位',
    currentEmail: '当前邮箱：{email}',
    newEmail: '新邮箱',
    newEmailPlaceholder: '输入新邮箱',
    confirmChange: '确认',
    verificationCode: '验证码',
    verificationCodePlaceholder: '输入验证码',
    sendCode: '发送验证码',
    resendCode: '重新发送 ({seconds}s)',
    codeSentToBound: '，已发送到绑定的邮箱',
    codeSentToNew: '，已发送到新邮箱',
    codeInvalid: '验证码不正确',
    codeExpired: '验证码已过期，请重新发送',
    pwdMinLength: '密码不符合要求：至少 6 位',
    submitting: '提交中…',
    pwdSuccess: '密码修改成功',
    emailEmpty: '请输入新邮箱',
    emailInvalid: '邮箱格式不正确',
    emailSame: '新邮箱与当前邮箱相同',
    emailSuccess: '邮箱换绑成功',
    submittingClose: '提交进行中，请稍候再关闭',
    sendFailed: '验证码发送失败，请重试',
    emailTaken: '该邮箱已被其他用户使用',
  },
  // 问题与反馈弹窗
  feedback: {
    empty: '请填写反馈内容',
    submitFailed: '反馈提交失败，请重试',
    submitted: '反馈已提交，感谢你的反馈',
    anonymousHint: '匿名提交，管理员可在后台查看',
    version: '当前版本：{version}',
    placeholder: '写下你的问题或建议',
  },
  // 外观弹窗
  appearance: {
    dark: '暗色',
    light: '亮色',
    followSystemShort: '跟随系统',
    currentMode: '当前为「{mode}」模式',
    followSystem: '（跟随系统：随设备系统外观自动切换）',
  },
  // 考勤查看弹窗
  attendance: {
    title: '我的考勤',
    status: {
      present: '出席',
      late: '迟到',
      absent: '缺勤',
      excused: '请假',
    },
    startDate: '开始日期',
    endDate: '结束日期',
    unlimited: '不限',
    to: '至',
    startAfterEnd: '开始日期不能晚于结束日期',
    loadFailed: '加载失败，请稍后重试',
    empty: '该区间暂无考勤记录',
    timeUnset: '时间未设置',
    location: '地点：{location}',
    repertoire: '曲目：{repertoire}',
    totalRehearsals: '共 {count} 次排练',
  },
  // 头像裁剪上传
  avatarCropTitle: '裁剪头像',
  avatarTooLarge: '图片过大，请选择 2MB 以内的图片',
  avatarSaved: '头像已保存',
  avatarSaveFailed: '头像保存失败，请重试',
  avatarModerationFailed: '头像图片未通过审核',
  avatarSourceTitle: '选择头像来源',
  avatarSourceWechat: '使用微信头像',
  avatarSourceFile: '从相册选择',
}
