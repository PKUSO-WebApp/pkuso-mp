# 自定义 tabBar（custom tabBar）改造评估

> 背景：当前小程序底部弹窗（Modal，`position='bottom'`）贴底存在两个问题——
> 1. 弹窗底边高于设备屏幕底边（原生 tabBar 占据 webview 之下的一截，webview 底边止于 tabBar 顶边）；
> 2. 打开弹窗时调用 `Taro.hideTabBar()` 会闪现一帧白色占位条（原生层永远盖在 webview 上），产生闪烁。
>
> 这两个问题都源于“tabBar 是原生组件”这一平台限制。要让弹窗像 web 端一样覆盖 tabBar、**彻底无闪烁**，
> 唯一做法是把原生 tabBar 改为**自定义 tabBar**（`tabBar.custom: true`，用 webview 组件渲染）。
> 本文记录该方案的优缺点、实现困难，以及它解决/引入的 trade-off。

## 方案概述

1. `app.config.ts` 的 `tabBar` 增加 `custom: true`（保留 `list` 供 `switchTab` 与框架识别）。
2. 新增 `src/custom-tab-bar/index.tsx` + `.scss`：固定底部、白底黑顶边、5 个 tab（图标用 `assets/icons/*.png`，
   选中态按当前路由高亮文字色）、底部安全区内边距、`z-index` 低于 Modal（Modal 为 z-[60]）。
   点击 `Taro.switchTab` 跳转。
3. 新增 `src/lib/tabBarBadge.ts`：模块级外部 store（未读数），供 custom tabBar 订阅渲染红点。
4. `notification-badge-sync.tsx`：不再调 `showTabBarRedDot`/`hideTabBarRedDot`，改为写 store。
5. 移除 `badge-sync-context.tsx` 及 5 个 tab 页的 `useTabBarBadgeSync()`（冷启动 workaround 不再需要）。
6. `theme-context.tsx`：移除/守卫 `Taro.setTabBarStyle`（custom tabBar 自管主题）。
7. `Modal.tsx`：移除 `hideTabBar`/`showTabBar` 逻辑（不再需要隐藏任何原生层）。

## 优点

- **弹窗彻底覆盖 tabBar、零闪烁、零白条**，与 web 端行为完全一致。
- 弹窗底边真正到达设备屏幕底边（解决原始抱怨）。
- **通知红点更健壮**：custom tabBar 常驻、store 驱动，不再有冷启动竞态
  （此前冷启动停在登录页→“not TabBar page”→原生红点被静默丢弃，需 `useDidShow` 逐 tab 补救）。
- **暗色主题一致性更好**：custom tabBar 作为 webview 组件可直接用全站主题 CSS 类，
  不必再靠 `Taro.setTabBarStyle` 单独同步原生 tabBar 配色。

## 缺点 / 实现困难

- **更高爆炸半径**：tab 导航与外观完全依赖自写组件，一处 bug 影响全部 tab 页
  （原生 tabBar 是“免费且稳定”的）。
- **custom tabBar 不继承 `<App>` 的 React Context**（Taro 已知限制，它被框架单独挂载）：
  - 红点 → 必须用**模块级外部 store**（非 Context）。
  - 暗色主题 → custom tabBar 拿不到 `theme-context` 的 Context，需**自己订阅主题**（store 或全局 class）再套 `dark:` 类。
    这是设计上必须明确的核心点。
- **外观需 1:1 复刻**原生 tabBar：图标、选中文字色、顶边、安全区内边距、高度。
  当前配置选中/未选中图标相同（只靠文字色区分），复刻成本较低。
- **无法在本地环境真机验证**：只能 typecheck/lint/test/build，视觉与导航需在模拟器/真机回归。
- 需重写 `notification-badge-sync.test.tsx`（断言 store 写入而非 `showTabBarRedDot`）、清理 `Modal.test.tsx` 的 Taro mock。

## 解决的 trade-off（此前因“不用 custom tabBar”而做的妥协）

| 编号 | 之前的问题 / 妥协 | 改 custom 后 |
|---|---|---|
| A | Modal 底边高于屏幕底边（webview 底边止于 tabBar 顶边） | 彻底解决（无原生 tabBar，Modal 铺满） |
| B | 打开 Modal 时 `hideTabBar` 闪白条 | 彻底解决（不再隐藏任何原生层） |
| C | 通知红点依赖原生 `showTabBarRedDot`，引出整套 `badge-sync-context` + 各 tab 页 `useDidShow` 冷启动 workaround | 改为自画红点（store 驱动），可删掉脆弱的冷启动逻辑，更稳 |
| D | `theme-context` 用 `Taro.setTabBarStyle` 给原生 tabBar 换色 | custom tabBar 用全站主题 CSS 类，一致性更好；`setTabBarStyle` 调用移除/守卫 |
| E | Modal 遮罩 `pb-[env(safe-area-inset-bottom)]`（藏 tabBar 后需避开 home indicator） | 保留（custom tabBar 仍在，sheet 仍需避开 home indicator） |
| F | Modal 的 `hide/showTabBar` 逻辑 | 删除 |

## 新引入的 trade-off / 风险

1. tab 导航完全自管，健壮性从“系统保证”变为“代码保证”。
2. Context 不传递 → 红点与主题必须走外部 store / 全局 class，增加少量架构复杂度。
3. 真机视觉与导航回归成本（需人工在模拟器/真机确认）。

## 工作量估计

- `app.config.ts`：极小（加一行 `custom: true`）。
- `custom-tab-bar` 组件 + 样式：**最大，约 150–200 行**（5 tab、选中高亮、安全区、暗色主题、红点）。
- `tabBarBadge` store：小（约 30 行 + `useSyncExternalStore`）。
- `notification-badge-sync` 改写 + `badge-sync-context` 删除 + 5 处页面调用清理：中。
- `theme-context` 守卫 `setTabBarStyle`：小。
- `Modal` 删除 hide/show 逻辑：小。
- 测试改写：小。
- **总体：中等重构，约半天工作量。** 两个难点是 (a) 红点外部 store 接线，(b) custom tabBar 的暗色主题获取方式。

## 关键设计决策（开工前需确认）

- 红点、主题均使用**模块级外部 store**（避开 Context 不传递问题），而非 React Context。
- 暗色主题：custom tabBar 组件自行订阅主题 store 并套 `dark:` 类，不依赖 `<App>` 的 Context。

## 验证方式

- `pnpm typecheck` / `eslint` / `vitest run` / `pnpm build:weapp` 全绿。
- 视觉与 tab 导航、红点、暗色主题需在微信开发者工具 / 真机回归（本地环境无法覆盖）。

---

### 临时备注

- 当前 `Modal.tsx` 的 `hideTabBar`/`showTabBar` 临时使用 `animation: false`
  （真机调试确认可接受的淡入淡出取消；此前曾在 `true`/`false` 间切换）。
- 在 custom tabBar 落地前，弹窗贴底由原生 `hideTabBar` 方案承担，闪烁问题仍待 custom tabBar 解决。
