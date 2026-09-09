import { Component } from 'react'
import Taro from '@tarojs/taro'
import { View, Image } from '@tarojs/components'
import { getTabBarUnread, subscribeTabBarUnread } from '@/lib/tabBarBadge'
import { getRehearsalUnviewedFlag, subscribeRehearsalUnviewed } from '@/lib/rehearsalSeen'
// [FALLBACK] 社区隐藏，post 未读 import 暂时注释。恢复时取消注释。
// import { getPostUnviewedFlag, subscribePostUnviewed } from '@/lib/postSeen'
import { getThemeMode, subscribeThemeMode } from '@/lib/themeStore'
import { THEME_PALETTE } from '@/lib/theme'
import { getOverlayOpen, subscribeOverlayOpen } from '@/lib/overlayStore'
import { getTabBarSelected, setTabBarSelected, subscribeTabBarSelected } from '@/lib/tabBarSelected'
import { getLoggedIn, subscribeLoggedIn } from '@/lib/authStore'
import house from '@/assets/icons/house.png'
import houseActive from '@/assets/icons/house-active.png'
import houseActiveDark from '@/assets/icons/house-active-dark.png'
// [FALLBACK] 社区 tab 恢复时需补回以下 import：
// import messageSquare from '@/assets/icons/message-square.png'
// import messageSquareActive from '@/assets/icons/message-square-active.png'
// import messageSquareActiveDark from '@/assets/icons/message-square-active-dark.png'
import calendar from '@/assets/icons/calendar.png'
import calendarActive from '@/assets/icons/calendar-active.png'
import calendarActiveDark from '@/assets/icons/calendar-active-dark.png'
import users from '@/assets/icons/users.png'
import usersActive from '@/assets/icons/users-active.png'
import usersActiveDark from '@/assets/icons/users-active-dark.png'
import user from '@/assets/icons/user.png'
import userActive from '@/assets/icons/user-active.png'
import userActiveDark from '@/assets/icons/user-active-dark.png'
import { subscribeLocale, translateCurrent } from '@/i18n'

// 底边栏 UI：由框架专用槽位组件 src/custom-tab-bar 渲染，状态（选中/未读/主题/Modal 覆盖）
// 均来自全局 store，故每个 tab 页实例保持一致、无闪烁/无双实例失联。
// 必须用普通 View（非 CoverView）：CoverView 是原生顶层，opacity:0 仍会拦截底部触摸，
// 导致 Modal 底部按钮点不到；改用 View + display:none 既能真正移除（不拦截触摸），
// 又不会像 CoverView 那样在 display 切换时重建原生节点而闪烁。
const LIST = [
  {
    pagePath: '/pages/index/index',
    key: 'ui.tabBar.home',
    icon: house,
    selectedIcon: houseActive,
    selectedIconDark: houseActiveDark,
  },
  // [FALLBACK] 社区页面因无法通过微信服务类目审核，暂时隐藏入口。
  // 恢复时取消下方注释，并同步恢复 dataSync.ts 中 post 轮询逻辑。
  // {
  //   pagePath: '/pages/community/index',
  //   key: 'ui.tabBar.community',
  //   icon: messageSquare,
  //   selectedIcon: messageSquareActive,
  //   selectedIconDark: messageSquareActiveDark,
  // },
  {
    pagePath: '/pages/schedule/index',
    key: 'ui.tabBar.schedule',
    icon: calendar,
    selectedIcon: calendarActive,
    selectedIconDark: calendarActiveDark,
  },
  {
    pagePath: '/pages/members/index',
    key: 'ui.tabBar.members',
    icon: users,
    selectedIcon: usersActive,
    selectedIconDark: usersActiveDark,
  },
  {
    pagePath: '/pages/profile/index',
    key: 'ui.tabBar.profile',
    icon: user,
    selectedIcon: userActive,
    selectedIconDark: userActiveDark,
  },
] as const

// 色板单一真相源：lib/theme.ts THEME_PALETTE（与语义 token 亮/暗值一致，P2-8）。
// active=选中文字色，inactive=未选中（更浅），dot=未读红点
const paletteFor = (dark: boolean) => {
  const p = THEME_PALETTE[dark ? 'dark' : 'light']
  return {
    bg: p.tabBg,
    border: p.tabBorder,
    active: p.tabActive,
    inactive: p.tabInactive,
    dot: p.tabDot,
  }
}

export default class CustomTabBar extends Component {
  state = {
    selected: getTabBarSelected(),
    unread: getTabBarUnread(),
    rehearsalUnviewed: getRehearsalUnviewedFlag(),
    dark: getThemeMode() === 'dark',
    overlay: getOverlayOpen(),
    loggedIn: getLoggedIn(),
  }

  componentDidMount() {
    this.unsubSelected = subscribeTabBarSelected(() => {
      const selected = getTabBarSelected()
      this.setState({ selected })
    })
    this.unsubUnread = subscribeTabBarUnread(() => this.setState({ unread: getTabBarUnread() }))
    this.unsubRehearsal = subscribeRehearsalUnviewed(() =>
      this.setState({ rehearsalUnviewed: getRehearsalUnviewedFlag() })
    )
    // [FALLBACK] 社区隐藏，post 未读订阅暂停。恢复时取消注释。
    // this.unsubPost = subscribePostUnviewed(() =>
    //   this.setState({ postUnviewed: getPostUnviewedFlag() })
    // )
    this.unsubTheme = subscribeThemeMode(() => this.setState({ dark: getThemeMode() === 'dark' }))
    this.unsubOverlay = subscribeOverlayOpen(() => this.setState({ overlay: getOverlayOpen() }))
    this.unsubAuth = subscribeLoggedIn(() => this.setState({ loggedIn: getLoggedIn() }))
    // 语言切换时重渲染 tab 文字（底边栏由框架独立槽位渲染，不在 React Provider 树内）
    this.unsubLocale = subscribeLocale(() => this.forceUpdate())
  }

  componentWillUnmount() {
    this.unsubSelected?.()
    this.unsubUnread?.()
    this.unsubRehearsal?.()
    this.unsubPost?.()
    this.unsubTheme?.()
    this.unsubOverlay?.()
    this.unsubAuth?.()
    this.unsubLocale?.()
  }

  unsubSelected?: () => void
  unsubUnread?: () => void
  unsubRehearsal?: () => void
  unsubPost?: () => void
  unsubTheme?: () => void
  unsubOverlay?: () => void
  unsubAuth?: () => void
  unsubLocale?: () => void

  switchTab = (idx: number) => {
    // 未登录时点击"我的" tab，跳转到登录页
    if (idx === 3 && !this.state.loggedIn) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    setTabBarSelected(idx)
    Taro.switchTab({ url: LIST[idx].pagePath })
  }

  render() {
    const { selected, unread, rehearsalUnviewed, dark, overlay } = this.state
    const c = paletteFor(dark)
    return (
      <View
        style={{
          position: 'fixed',
          left: '0',
          right: '0',
          bottom: '0',
          zIndex: '50',
          display: overlay ? 'none' : 'flex',
          boxSizing: 'border-box',
          height: 'calc(50px + env(safe-area-inset-bottom))',
          paddingBottom: 'env(safe-area-inset-bottom)',
          alignItems: 'stretch',
          background: c.bg,
          borderTopWidth: '1px',
          borderTopColor: c.border,
        }}
      >
        {LIST.map((tab, idx) => {
          const isSelected = selected === idx
          return (
            <View
              key={tab.pagePath}
              onClick={() => this.switchTab(idx)}
              style={{
                position: 'relative',
                flex: '1',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View style={{ position: 'relative', display: 'flex' }}>
                <Image
                  // 暗色模式选中态用高亮暗版图标（active-dark），避免与深底色融为一体
                  src={isSelected ? (dark ? tab.selectedIconDark : tab.selectedIcon) : tab.icon}
                  style={{ width: '24px', height: '24px' }}
                />
                {idx === 3 && unread > 0 && (
                  <View
                    style={{
                      position: 'absolute',
                      top: '-1px',
                      right: '-1px',
                      width: '8px',
                      height: '8px',
                      borderRadius: '9999px',
                      background: c.dot,
                      borderWidth: '1px',
                      borderColor: c.bg,
                    }}
                  />
                )}
                {idx === 0 && rehearsalUnviewed && (
                  <View
                    style={{
                      position: 'absolute',
                      top: '-1px',
                      right: '-1px',
                      width: '8px',
                      height: '8px',
                      borderRadius: '9999px',
                      background: c.dot,
                      borderWidth: '1px',
                      borderColor: c.bg,
                    }}
                  />
                )}
                {/* [FALLBACK] 社区 tab 隐藏，红点逻辑同步注释。恢复时取消注释。 */}
                {/* {idx === 1 && postUnviewed && (
                  <View
                    style={{
                      position: 'absolute',
                      top: '-1px',
                      right: '-1px',
                      width: '8px',
                      height: '8px',
                      borderRadius: '9999px',
                      background: c.dot,
                      borderWidth: '1px',
                      borderColor: c.bg,
                    }}
                  />
                )} */}
              </View>
              <View
                style={{
                  marginTop: '2px',
                  fontSize: '10px',
                  color: isSelected ? c.active : c.inactive,
                }}
              >
                {translateCurrent(tab.key)}
              </View>
            </View>
          )
        })}
      </View>
    )
  }
}
