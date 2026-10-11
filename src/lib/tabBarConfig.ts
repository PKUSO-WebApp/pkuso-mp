// tabBar 各 tab 页路径（带前导斜杠），与 app.config.ts 的 tabBar.list 一一对应。
// 由「框架逐页挂载的 controller」用来把当前路由换算成选中索引，写入全局 store。
// 注意：与 CustomTabBar.tsx 的 LIST 保持一一对应，community 暂时隐藏需同步移除。
export const TAB_PAGE_PATHS = [
  '/pages/index/index',
  '/pages/score/index',
  '/pages/schedule/index',
  '/pages/members/index',
  '/pages/profile/index',
] as const
