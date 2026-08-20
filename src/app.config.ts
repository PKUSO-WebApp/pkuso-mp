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
      { pagePath: 'pages/index/index', text: '首页' },
      { pagePath: 'pages/community/index', text: '社区' },
      { pagePath: 'pages/schedule/index', text: '日程' },
      { pagePath: 'pages/members/index', text: '成员' },
      { pagePath: 'pages/profile/index', text: '我的' },
    ],
  },
})
