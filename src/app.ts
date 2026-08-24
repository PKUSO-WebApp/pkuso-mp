import { createElement, Fragment, PropsWithChildren } from 'react'
import Taro, { useLaunch } from '@tarojs/taro'
import { UserProvider } from './context/user-context'
import { ThemeProvider } from './context/theme-context'
import { NotificationBadgeSync } from './components/notification-badge-sync'
import { PostUnviewedSync } from './components/post-unviewed-sync'
import { DataSyncProvider } from './components/data-sync-provider'
import { ErrorBoundary } from './components/error-boundary'

import './app.css'
import './app.scss'

const IGNORE_ERRORS = [/not TabBar page/i]

function App({ children }: PropsWithChildren<any>) {
  useLaunch(() => {
    const report = (err: unknown) => {
      const e = err as { message?: string; stack?: string }
      const message = typeof err === 'string' ? err : (e?.message ?? '未知错误')
      if (IGNORE_ERRORS.some((re) => re.test(message))) return
      const pages = Taro.getCurrentPages?.() ?? []
      const cur = pages[pages.length - 1]?.route ?? ''
      if (cur.endsWith('/error/index')) return
      const stack = typeof err === 'string' ? '' : (e?.stack ?? '')
      const url = `/pages/error/index?msg=${encodeURIComponent(message)}&stack=${encodeURIComponent(stack)}`
      Taro.redirectTo({ url }).catch(() => {})
    }
    Taro.onError(report)
    Taro.onUnhandledRejection((res) => report(res?.reason ?? res))
  })

  // children 是将要会渲染的页面；Provider 在冷启动恢复会话/主题并供各页面使用。
  // 注：app.ts 是 .ts 文件不能写 JSX，此处用 createElement 包 Provider
  // ErrorBoundary 在最外层捕获渲染错误；NotificationBadgeSync 挂载于 App 根维护「我的」tab 红点。
  // 底边栏 UI 由框架专用槽位组件 src/custom-tab-bar 渲染（custom:true），不在 App 根渲染。
  return createElement(
    ErrorBoundary,
    null,
    createElement(
      UserProvider,
      null,
        createElement(
          ThemeProvider,
          null,
          createElement(
            DataSyncProvider,
            null,
            createElement(
              NotificationBadgeSync,
              null,
              createElement(
                Fragment,
                null,
                createElement(PostUnviewedSync, null),
                children
              )
            )
          )
        )
    )
  )
}

export default App
