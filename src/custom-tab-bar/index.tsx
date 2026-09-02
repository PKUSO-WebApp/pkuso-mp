import { Component } from 'react'
import Taro from '@tarojs/taro'
import CustomTabBar from '@/components/CustomTabBar'
import { setTabBarSelected } from '@/lib/tabBarSelected'
import { TAB_PAGE_PATHS } from '@/lib/tabBarConfig'

// 框架会把 custom-tab-bar 组件的输出渲染到底边栏专用槽位（custom:true 时原生 tabBar 被隐藏）。
// 这里渲染真正的 UI 组件 CustomTabBar，并把当前路由换算成选中索引写入全局 store。
// 状态（选中/未读/主题/Modal 覆盖）均来自全局 store，故每个 tab 页的实例保持一致、无闪烁/无双实例失联。
// custom-tab-bar 仅挂在 tab 页 → 非 tab 页（如登录）天然不渲染底边栏。
export default class CustomTabBarRoot extends Component {
  componentDidMount() {
    this.sync()
  }

  componentDidShow() {
    this.sync()
  }

  private sync() {
    const idx = this.computeSelected()
    if (idx >= 0) setTabBarSelected(idx)
  }

  // componentDidShow 时机 getCurrentPages() 可能尚未就绪，故优先用 router.path 取当前页路径
  private computeSelected(): number {
    const path = (Taro.getCurrentInstance()?.router?.path as string | undefined)?.replace(/^\//, '')
    if (path) {
      const idx = TAB_PAGE_PATHS.findIndex((p) => p === `/${path}` || p === path)
      if (idx >= 0) return idx
    }
    const pages = Taro.getCurrentPages()
    const route = pages[pages.length - 1]?.route as string | undefined
    if (route) {
      return TAB_PAGE_PATHS.findIndex((p) => p === `/${route}` || p === route)
    }
    return -1
  }

  render() {
    return <CustomTabBar />
  }
}
