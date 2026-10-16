export const ui = {
  adminBlocked: {
    title: 'Admin console is not available in the mini program. Please use the web app.',
    desc: 'The mini program is for orchestra members only. Approval, rehearsal management, attendance stats and other admin features are on the web app.',
    logout: 'Log Out',
    loggingOut: 'Logging out…',
  },
  staffBlocked: {
    title: 'This account cannot use the mini program. Please use the web app.',
    desc: 'The mini program is for orchestra members only; staff accounts such as score managers work on the web app.',
    logout: 'Log Out',
    loggingOut: 'Logging out…',
  },
  forceOffline: {
    rejected: {
      title: 'This device has been denied sign-in',
      line1:
        'This device was marked "not trusted" and has been signed out. It cannot sign in again until you trust it again.',
      line2: 'If this was not you, open Me - Login Devices on another device to review it.',
    },
    deleted: {
      title: 'This device has been removed from your account',
      line1:
        'This device was removed from your account and has been signed out. The next time it signs in, it will be treated as a new device and you will get a notification.',
      line2: 'If this was not you, open Me - Login Devices on another device to review it.',
    },
    confirm: 'OK',
  },
  errorBoundary: {
    defaultMessage: 'An error occurred while rendering',
  },
  modal: {
    close: 'Close',
  },
  tabBar: {
    home: 'Home',
    community: 'Community',
    schedule: 'B108',
    score: 'Scores',
    members: 'Members',
    profile: 'Me',
  },
}
