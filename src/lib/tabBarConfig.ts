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

/**
 * 当前路由 → tab 索引；不是 tab 页返回 -1。
 *
 * 同时接受 `pages/x/index` 与 `/pages/x/index` 两种形态（`getCurrentPages()` 给前者，
 * `router.path` 给后者）。
 */
export function selectedTabIndex(route: string | null | undefined): number {
  if (!route) return -1
  const clean = route.replace(/^\//, '')
  return TAB_PAGE_PATHS.findIndex((path) => path === `/${clean}` || path === clean)
}

/**
 * 取「当前页」的路由时**页面栈优先**。
 *
 * custom-tab-bar 的 `getCurrentInstance().router.path` 可能是**上一次 tab** 的路径：
 * 页面切换时新 tab 栏实例先挂载、router 还没更新，旧值会把选中态写回上一个 tab
 * （实测：进入「日程」后「乐谱」仍高亮）。`getCurrentPages()` 的栈顶才是当前页；
 * 只有栈还没就绪（componentDidShow 早期）才退回 router.path。
 */
export function resolveTabRoute(
  pagesRoute: string | null | undefined,
  routerPath: string | null | undefined
): string {
  if (pagesRoute) return pagesRoute
  return routerPath ?? ''
}
