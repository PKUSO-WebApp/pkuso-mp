import { createElement, PropsWithChildren } from 'react'
import { useLaunch } from '@tarojs/taro'
import { UserProvider } from './context/user-context'
import { ThemeProvider } from './context/theme-context'

import './app.css'
import './app.scss'

function App({ children }: PropsWithChildren<any>) {
  useLaunch(() => {
    console.log('App launched.')
  })

  // children 是将要会渲染的页面；Provider 在冷启动恢复会话/主题并供各页面使用。
  // 注：app.ts 是 .ts 文件不能写 JSX，此处用 createElement 包 Provider
  return createElement(UserProvider, null, createElement(ThemeProvider, null, children))
}

export default App
