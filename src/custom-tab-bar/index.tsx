import { Component } from 'react'
import Taro from '@tarojs/taro'
import CustomTabBar from '@/components/CustomTabBar'
import { setTabBarSelected } from '@/lib/tabBarSelected'
import { resolveTabRoute, selectedTabIndex } from '@/lib/tabBarConfig'

// 框架会把 custom-tab-bar 组件的输出渲染到底边栏专用槽位（custom:true 时原生 tabBar 被隐藏）。
// 这里渲染真正的 UI 组件 CustomTabBar，并把当前路由换算成选中索引写入全局 store。
// 状态（选中/未读/主题/Modal 覆盖）均来自全局 store，故每个 tab 页的实例保持一致、无闪烁/无双实例失联。
// custom-tab-bar 仅挂在 tab 页 → 非 tab 页（如登录）天然不渲染底边栏。
export default class CustomTabBarRoot extends Component {
  componentDidMount() {
    this.sync()
    this.queueSync()
  }

  componentWillUnmount() {
    if (this.syncTimer) clearTimeout(this.syncTimer)
  }

  componentDidShow() {
    this.sync()
    this.queueSync()
  }

  private syncTimer: ReturnType<typeof setTimeout> | null = null

  private sync() {
    const idx = this.computeSelected()
    if (idx >= 0) setTabBarSelected(idx)
  }

  /**
   * 再补一次：新 tab 栏实例挂载时，`Taro.switchTab` 可能还没把新页压进页面栈，
   * 这一次同步会读到旧路由。点击处理已先把选中态写对，但挂载同步可能用旧值把它
   * 覆盖回去；下一拍再读一次页面栈，把最终值纠正过来。
   */
  private queueSync() {
    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null
      this.sync()
    }, 0)
  }

  /**
   * 页面栈优先。custom-tab-bar 的 router.path 可能还是上一个 tab 的路径：新 tab 栏
   * 实例先挂载、router 后更新，旧值会把选中态写回上一个 tab（实测：进「日程」后
   * 「乐谱」仍高亮）。只有栈还没就绪时才退回 router.path。
   */
  private computeSelected(): number {
    const pages = Taro.getCurrentPages?.() ?? []
    const pagesRoute = pages[pages.length - 1]?.route as string | undefined
    const routerPath = Taro.getCurrentInstance()?.router?.path as string | undefined
    return selectedTabIndex(resolveTabRoute(pagesRoute, routerPath))
  }

  render() {
    return <CustomTabBar />
  }
}
