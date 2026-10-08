import { createElement, Fragment, PropsWithChildren } from 'react'
import Taro, { useLaunch } from '@tarojs/taro'
import { UserProvider } from './context/user-context'
import { ThemeProvider } from './context/theme-context'
import { NotificationBadgeSync } from './components/notification-badge-sync'
import { PostUnviewedSync } from './components/post-unviewed-sync'
import { LanguageProvider } from './i18n'
import { DataSyncProvider } from './components/data-sync-provider'
import { ErrorBoundary } from './components/error-boundary'
import { logDiag, startSessionDiag } from './lib/session-diag'
import { installSessionDiagFileSink } from './lib/session-diag-file'
import { flushErrorQueue, refreshNetworkType, reportClientError } from './lib/error-report'
import { setRequestFailureReporter, setRequestSuccessHook } from './lib/supabase'
import { dataSyncResync } from './lib/dataSync'
import { isNavigationError, showNavigateFailedToast } from './lib/navigate'

import './app.css'
import './app.scss'

const IGNORE_ERRORS = [/not TabBar page/i]

function App({ children }: PropsWithChildren<any>) {
  useLaunch(() => {
    // 接上「请求失败统一上报」的口子。supabase.ts 不能直接 import error-report
    // （后者依赖 supabase，会成环），只能在这里注入——漏了这行，全站的请求失败
    // 都不会再上报。
    setRequestFailureReporter((input) => {
      reportClientError(input)
    })
    // 任何一次成功的请求都意味着网通了——这是「断网恢复」最可靠的补送信号
    // （onNetworkStatusChange 在开发者工具模拟离线时未必触发）。队列为空时
    // flushErrorQueue 立即返回，挂在这里无额外开销。
    setRequestSuccessHook(flushErrorQueue)
    installSessionDiagFileSink()
    startSessionDiag()
    logDiag('app_launch', { env: process.env.TARO_ENV })
    const extractError = (err: unknown): { message: string; stack: string } => {
      if (typeof err === 'string') {
        return { message: err, stack: '' }
      }
      if (err instanceof Error) {
        return { message: err.message || String(err), stack: err.stack || '' }
      }
      if (err && typeof err === 'object') {
        const obj = err as Record<string, unknown>
        const message = obj.errMsg ?? obj.message ?? obj.error ?? obj.reason ?? obj.msg
        const stack = obj.stack ?? obj.trace
        if (typeof message === 'string' && message) {
          return {
            message,
            stack: typeof stack === 'string' ? stack : stack ? String(stack) : '',
          }
        }
        try {
          const json = JSON.stringify(err)
          if (json && json !== '{}') {
            return { message: json, stack: '' }
          }
        } catch {
          // JSON.stringify failed
        }
        return { message: String(err), stack: '' }
      }
      return { message: String(err ?? '未知错误'), stack: '' }
    }

    const report = (err: unknown, event: string) => {
      const { message, stack } = extractError(err)
      if (IGNORE_ERRORS.some((re) => re.test(message))) return
      const pages = Taro.getCurrentPages?.() ?? []
      const cur = pages[pages.length - 1]?.route ?? ''
      if (cur.endsWith('/error/index')) return
      // 跳转失败（issue #7）走另一条路：断网时 navigateTo / switchTab 会超时失败，但用户
      // 还停在原来那一屏、应用本身是好的——把他送到整页错误屏比失败本身更糟。
      // 给一句轻提示就够，人要做的只是重试或等网络回来（见下面的 onNetworkStatusChange）。
      const navFailed = isNavigationError(message)
      // 回传库：redirectTo 到错误页只有当事用户看得到，且页面一关就没了——
      // 库里那份才能跨用户聚合、事后追查（这正是「复现不了」时唯一的手段）。
      reportClientError({
        event: navFailed ? 'navigate_failed' : event,
        message,
        detail: { stack, route: cur },
      })
      if (navFailed) {
        showNavigateFailedToast()
        return
      }
      const url = `/pages/error/index?msg=${encodeURIComponent(message)}&stack=${encodeURIComponent(stack)}`
      Taro.redirectTo({ url }).catch(() => {})
    }
    Taro.onError((err) => report(err, 'app_error'))
    Taro.onUnhandledRejection((res) => report(res?.reason ?? res, 'unhandled_rejection'))

    // 补送上次断网期间积压的错误记录：冷启动一次，网络恢复再一次
    // （错误发生的那一刻常常正是断网时刻，那次上报必然失败）
    flushErrorQueue()
    // 网络状态是排查的第一个问题，但 getNetworkType 只有异步版，而报错路径要的是
    // 同步可得的上下文 ⇒ 缓存一份，在这三处刷新（见 error-report.refreshNetworkType）
    refreshNetworkType()
    Taro.onNetworkStatusChange?.((res) => {
      refreshNetworkType()
      if (!res.isConnected) return
      // 两件事，各修一半问题：
      // 1) 补送断网期间积压的**错误上报**（队列的存在理由就是这个时刻）；
      // 2) 重取断网期间失败的**业务数据**——重试只在「点击/加载」那一刻起作用，用户停在
      //    那一屏不动时没人再试，于是「网回来了页面还是空的」（issue #7）。见 dataSyncResync。
      flushErrorQueue()
      dataSyncResync()
    })
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
          LanguageProvider,
          null,
          createElement(
            DataSyncProvider,
            null,
            createElement(
              NotificationBadgeSync,
              null,
              createElement(Fragment, null, createElement(PostUnviewedSync, null), children)
            )
          )
        )
      )
    )
  )
}

export default App
