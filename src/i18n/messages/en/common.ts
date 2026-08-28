// 公共文案（跨页面复用：按钮、加载态等）
export const common = {
  appName: 'PKU Symphony Orchestra',
  actions: {
    save: 'Save',
    cancel: 'Cancel',
    confirm: 'OK',
    openSettings: 'Open Settings',
    delete: 'Delete',
    edit: 'Edit',
    lock: 'Lock',
    unlock: 'Unlock',
    loading: 'Loading…',
    retry: 'Retry',
    submit: 'Submit',
  },
  fields: {
    email: 'Email',
    password: 'Password',
    confirmPassword: 'Confirm Password',
    fullName: 'Full Name',
  },
  approval: {
    pending: {
      title: 'Waiting for Admin Review',
      desc: 'Your profile has been submitted. The mini program will be available after admin approval.',
    },
    rejected: {
      title: 'Review Rejected, Contact Admin',
      desc: 'If you have questions, please contact the orchestra admin.',
    },
    refresh: 'Refresh Status',
    checking: 'Checking…',
    logout: 'Log Out',
    exiting: 'Logging out…',
    loading: 'Loading…',
  },
  error: {
    defaultTitle: 'Page error',
    copySuccess: 'Error info copied',
    copyFailed: 'Copy failed',
    copyButton: 'Copy error info',
    hint: 'Please send the copied info to the orchestra admin so we can fix it soon.',
  },
  errors: {
    loadFailed: 'Failed to load data, please retry',
    saveFailed: 'Operation failed, please retry',
  },
  hidden: '（Hidden）',
  notFilled: 'Not filled',
  joinDate: {
    tpl: '{season} {year}',
    season: {
      spring: 'Spring',
      fall: 'Fall',
    },
  },
}
