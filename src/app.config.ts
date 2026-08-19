export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/community/index',
    'pages/schedule/index',
    'pages/members/index',
    'pages/profile/index'
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: '北大交响乐团',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f4f4f5'
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
      { pagePath: 'pages/profile/index', text: '我的' }
    ]
  }
})