import { createElement, PropsWithChildren } from 'react'
import { useLaunch } from '@tarojs/taro'
import { UserProvider } from './context/user-context'

import './app.css'
import './app.scss'

function App({ children }: PropsWithChildren<any>) {
  useLaunch(() => {
    console.log('App launched.')
  })

  // children 是将要会渲染的页面；UserProvider 在冷启动恢复会话并供各页面 useUser。
  // 注：app.ts 是 .ts 文件不能写 JSX，此处用 createElement 包一层 Provider
  return createElement(UserProvider, null, children)
}

export default App
