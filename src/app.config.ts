export default defineAppConfig({
  pages: [
    // 首位为启动页：登录页作为入口，已登录用户启动时按 profile 状态路由
    // （资料补全 → 等待审核 → 审核未通过 → 首页 tab）
    'pages/login/index',
    'pages/setup/index',
    'pages/pending/index',
    'pages/rejected/index',
    'pages/index/index',
    'pages/community/index',
    'pages/schedule/index',
    'pages/members/index',
    'pages/profile/index',
    'pages/error/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: '北大交响乐团',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f4f4f5',
  },
  tabBar: {
    color: '#71717a',
    selectedColor: '#18181b',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '首页',
        iconPath: 'assets/icons/house.png',
        selectedIconPath: 'assets/icons/house.png',
      },
      {
        pagePath: 'pages/community/index',
        text: '社区',
        iconPath: 'assets/icons/message-square.png',
        selectedIconPath: 'assets/icons/message-square.png',
      },
      {
        pagePath: 'pages/schedule/index',
        text: '日程',
        iconPath: 'assets/icons/calendar.png',
        selectedIconPath: 'assets/icons/calendar.png',
      },
      {
        pagePath: 'pages/members/index',
        text: '成员',
        iconPath: 'assets/icons/users.png',
        selectedIconPath: 'assets/icons/users.png',
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
        iconPath: 'assets/icons/user.png',
        selectedIconPath: 'assets/icons/user.png',
      },
    ],
  },
})
