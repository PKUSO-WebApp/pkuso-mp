import { Component } from 'react'
import Taro from '@tarojs/taro'
import { View, Image } from '@tarojs/components'
import {
  getTabBarUnread,
  subscribeTabBarUnread,
} from '@/lib/tabBarBadge'
import { getThemeMode, subscribeThemeMode } from '@/lib/themeStore'
import { getOverlayOpen, subscribeOverlayOpen } from '@/lib/overlayStore'
import {
  getTabBarSelected,
  setTabBarSelected,
  subscribeTabBarSelected,
} from '@/lib/tabBarSelected'
import house from '@/assets/icons/house.png'
import houseActive from '@/assets/icons/house-active.png'
import messageSquare from '@/assets/icons/message-square.png'
import messageSquareActive from '@/assets/icons/message-square-active.png'
import calendar from '@/assets/icons/calendar.png'
import calendarActive from '@/assets/icons/calendar-active.png'
import users from '@/assets/icons/users.png'
import usersActive from '@/assets/icons/users-active.png'
import user from '@/assets/icons/user.png'
import userActive from '@/assets/icons/user-active.png'

// 底边栏 UI：由框架专用槽位组件 src/custom-tab-bar 渲染，状态（选中/未读/主题/Modal 覆盖）
// 均来自全局 store，故每个 tab 页实例保持一致、无闪烁/无双实例失联。
// 必须用普通 View（非 CoverView）：CoverView 是原生顶层，opacity:0 仍会拦截底部触摸，
// 导致 Modal 底部按钮点不到；改用 View + display:none 既能真正移除（不拦截触摸），
// 又不会像 CoverView 那样在 display 切换时重建原生节点而闪烁。
const LIST = [
  { pagePath: '/pages/index/index', text: '首页', icon: house, selectedIcon: houseActive },
  {
    pagePath: '/pages/community/index',
    text: '社区',
    icon: messageSquare,
    selectedIcon: messageSquareActive,
  },
  {
    pagePath: '/pages/schedule/index',
    text: '日程',
    icon: calendar,
    selectedIcon: calendarActive,
  },
  { pagePath: '/pages/members/index', text: '成员', icon: users, selectedIcon: usersActive },
  { pagePath: '/pages/profile/index', text: '我的', icon: user, selectedIcon: userActive },
] as const

// active=选中文字/图标色（更深），inactive=未选中（更浅），提升对比度
const LIGHT = { bg: '#ffffff', border: '#e4e4e7', active: '#000000', inactive: '#a1a1aa' }
const DARK = { bg: '#09090b', border: '#27272a', active: '#ffffff', inactive: '#71717a' }

export default class CustomTabBar extends Component {
  state = {
    selected: getTabBarSelected(),
    unread: getTabBarUnread(),
    dark: getThemeMode() === 'dark',
    overlay: getOverlayOpen(),
  }

  componentDidMount() {
    this.unsubSelected = subscribeTabBarSelected(() => {
      const selected = getTabBarSelected()
      this.setState({ selected })
    })
    this.unsubUnread = subscribeTabBarUnread(() => this.setState({ unread: getTabBarUnread() }))
    this.unsubTheme = subscribeThemeMode(() =>
      this.setState({ dark: getThemeMode() === 'dark' })
    )
    this.unsubOverlay = subscribeOverlayOpen(() => this.setState({ overlay: getOverlayOpen() }))
  }

  componentWillUnmount() {
    this.unsubSelected?.()
    this.unsubUnread?.()
    this.unsubTheme?.()
    this.unsubOverlay?.()
  }

  unsubSelected?: () => void
  unsubUnread?: () => void
  unsubTheme?: () => void
  unsubOverlay?: () => void

  switchTab = (idx: number) => {
    setTabBarSelected(idx)
    Taro.switchTab({ url: LIST[idx].pagePath })
  }

  render() {
    const { selected, unread, dark, overlay } = this.state
    const c = dark ? DARK : LIGHT
    return (
      <View
        style={{
          position: 'fixed',
          left: '0',
          right: '0',
          bottom: '0',
          zIndex: '50',
          display: overlay ? 'none' : 'flex',
          height: '50px',
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
                  src={isSelected ? tab.selectedIcon : tab.icon}
                  style={{ width: '24px', height: '24px' }}
                />
                {idx === 4 && unread > 0 && (
                  <View
                    style={{
                      position: 'absolute',
                      top: '-1px',
                      right: '-1px',
                      width: '8px',
                      height: '8px',
                      borderRadius: '9999px',
                      background: '#dc2626',
                      borderWidth: '1px',
                      borderColor: c.bg,
                    }}
                  />
                )}
              </View>
              <View
                style={{
                  marginTop: '2px',
                  fontSize: '10px',
                  color: isSelected ? c.active : c.inactive,
                }}
              >
                {tab.text}
              </View>
            </View>
          )
        })}
      </View>
    )
  }
}
