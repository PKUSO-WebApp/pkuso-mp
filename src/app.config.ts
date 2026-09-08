export default defineAppConfig({
  pages: [
    // 首位为启动页：游客模式下直接进入首页，未登录用户可体验基本功能
    // 已登录用户启动时按 profile 状态路由（资料补全 → 等待审核 → 审核未通过 → 首页 tab）
    'pages/index/index',
    'pages/login/index',
    'pages/register/index',
    'pages/email-login/index',
    'pages/email-signup/index',
    'pages/setup/index',
    'pages/pending/index',
    'pages/rejected/index',
    'pages/community/index',
    'pages/schedule/index',
    'pages/members/index',
    'pages/profile/index',
    'pages/profile-info/index',
    'pages/error/index',
    'pages/rehearsal-detail/index',
    'pages/leave-request/index',
    'pages/leave-requests/index',
    'pages/post-create/index',
    'pages/post-detail/index',
    'pages/notification-system/index',
    'pages/my-activities/index',
    'pages/post-edit/index',
    'pages/feedback/index',
    'pages/attendance/index',
    'pages/agreement/index',
  ],
  // 原生 darkmode：系统暗色时原生顶栏/窗口按 theme.json 零延迟上色，消除冷启动白闪；
  // 手动覆盖仍由 setNavigationBarColor（useNavTitle / ThemeProvider）接管
  darkmode: true,
  themeLocation: 'theme.json',
  lazyCodeLoading: 'requiredComponents',
  permission: {
    'scope.userLocation': {
      desc: '用于核验您已到达排练地点完成签到',
    },
  },
  requiredPrivateInfos: ['getLocation'],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: 'PKUSO',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f4f4f5',
  },
  tabBar: {
    custom: true,
    color: '#71717a',
    selectedColor: '#18181b',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '首页',
        iconPath: 'assets/icons/house.png',
        selectedIconPath: 'assets/icons/house-active.png',
      },
      {
        pagePath: 'pages/community/index',
        text: '社区',
        iconPath: 'assets/icons/message-square.png',
        selectedIconPath: 'assets/icons/message-square-active.png',
      },
      {
        pagePath: 'pages/schedule/index',
        text: '日程',
        iconPath: 'assets/icons/calendar.png',
        selectedIconPath: 'assets/icons/calendar-active.png',
      },
      {
        pagePath: 'pages/members/index',
        text: '成员',
        iconPath: 'assets/icons/users.png',
        selectedIconPath: 'assets/icons/users-active.png',
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
        iconPath: 'assets/icons/user.png',
        selectedIconPath: 'assets/icons/user-active.png',
      },
    ],
  },
})
