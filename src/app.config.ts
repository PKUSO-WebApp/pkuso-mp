export default defineAppConfig({
  // 兜底口径：`taroFetch` 每次都显式传 timeout（API 8s / Storage 60s，见 lib/supabase.ts），
  // 所以这里只影响「没走 taroFetch 的请求」——即目前为零，属于防止将来有人直接调
  // Taro.request 而拿回 60s 平台默认值的保险。
  // ⚠️ 8s 是按 API 请求定的：**若是字节搬运（大文件下载/上传），必须自己显式传更长的 timeout**，
  // 否则慢网下会被这个默认值判死。
  networkTimeout: {
    request: 8000,
  },
  pages: [
    // 首位为启动页：游客模式下直接进入首页，未登录用户可体验基本功能
    // 已登录用户启动时按 profile 状态路由（资料补全 → 等待审核 → 审核未通过 → 首页 tab）
    'pages/index/index',
    'pages/login/index',
    'pages/register/index',
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
    'pages/score/index',
    'pages/score-detail/index',
    'pages/score-part/index',
  ],
  // 独立分包：PDF 渲染运行时（wechat-miniprogram-pdf，1.61MB）必须隔离在分包，
  // 否则主包超微信 2MB 上限（主包基线约 1.5MB）
  subpackages: [
    {
      root: 'pages/score-reader',
      pages: ['index'],
      name: 'scoreReader',
    },
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
        pagePath: 'pages/score/index',
        text: '谱务',
        iconPath: 'assets/icons/score.png',
        selectedIconPath: 'assets/icons/score-active.png',
      },
      // [FALLBACK] 社区页面因无法通过微信服务类目审核，暂时隐藏。恢复时取消注释。
      // {
      //   pagePath: 'pages/community/index',
      //   text: '社区',
      //   iconPath: 'assets/icons/message-square.png',
      //   selectedIconPath: 'assets/icons/message-square-active.png',
      // },
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
