import { View, Text } from '@tarojs/components'
import { useT } from '@/i18n'

type PageLoadingProps = {
  /** 页面自己的暗色类名（各页从 `useThemeClass()` 拿的那个；不传就是亮色） */
  darkClass?: string
  /**
   * 高度口径。**六处原先是混着用的**，这里保留两种以做到「纯搬运、不改观感」：
   *
   * - `'full'`（默认）：`min-h-full` —— 撑满**页面包裹层**（`.page { height: 100% }`）。
   *   登录 / 注册 / 设置 这几页用的是这个。
   * - `'screen'`：`min-h-screen` —— 撑满**视口**。文章详情与帖子编辑用的是这个
   *   （它们不在 tab 页里，底部没有浮层，两者当时差别不大）。
   *
   * ⚠️ 在 **tab 页**上用 `'screen'` 会多出一截：底边栏是 `position: fixed` 的浮层，
   * 视口高度的容器会延伸到它下面。改口径前先在真机看一眼。
   */
  height?: 'full' | 'screen'
  /** 字号口径：多数页面 `'sm'`，文章详情/编辑用 `'xs'`（原样保留） */
  size?: 'sm' | 'xs'
}

/**
 * 整页加载态（「还没准备好，先别渲染内容」）。
 *
 * 原先这段在六个页面里各写一遍，只有两处细节不同（`min-h-full` vs `min-h-screen`、
 * `text-sm` vs `text-xs`）—— 那正是「下次改文案/样式只改到五个」的形状。
 *
 * 与 `ListState` 的分工：`ListState` 管**列表**的 loading/error/empty 三态，
 * 本组件只管**整页**那一层（页面还没拿到数据时连骨架都不该画）。
 */
export function PageLoading({ darkClass = '', height = 'full', size = 'sm' }: PageLoadingProps) {
  const { t } = useT()
  return (
    <View
      className={`${darkClass} flex ${height === 'screen' ? 'min-h-screen' : 'min-h-full'} items-center justify-center bg-page-bg`}
    >
      <Text className={`${size === 'xs' ? 'text-xs' : 'text-sm'} text-text-muted`}>
        {t('common.actions.loading')}
      </Text>
    </View>
  )
}
