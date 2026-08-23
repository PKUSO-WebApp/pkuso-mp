// 模块级外部 store：自定义 tabBar 当前选中的 tab 索引（单一事实来源）。
// custom tabBar 在每个 tab 页都会挂载实例，若各实例各自维护 selected 会出现：
//   1) 快速连点后 active tab 与页面失联（各实例状态不同步）；
//   2) 切换瞬间闪烁（新实例先用错误索引初始化再纠正）。
// 故选中态集中到此 store，点击/路由变化时立即写入，所有实例订阅同一值。
// 可见性无需单独标志：custom-tab-bar 组件仅挂在 tab 页，非 tab 页（登录等）天然不渲染底边栏。
let selected = 0
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

/** 写入当前选中索引（点击/路由同步时立即调用，保证所有实例一致） */
export function setTabBarSelected(idx: number) {
  if (selected === idx) return
  selected = idx
  emit()
}

export function getTabBarSelected(): number {
  return selected
}

export function subscribeTabBarSelected(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
