# AGENTS.md

项目说明与协作规则（agent 必须遵守）。

## 交付闸门（Delivery Gate）

每次声明「完成 / 交付」前，必须依次执行且**全部通过（全绿）**才允许交付；任一环节失败不得宣告完成：

1. 重新构建：`pnpm build:weapp`
2. 类型检查：`pnpm typecheck`
3. 代码规范：`pnpm lint`
4. 单元测试：`pnpm test`

注：不要用 `Remove-Item` 删除 `dist/` 再构建（会在部分环境卡死），直接 `pnpm build:weapp` 即可。
微信开发者工具内的「清除缓存 / 重开项目」是 GUI 手动操作，agent 无法从命令行触发；
交付时请提醒用户在开发者工具中点一次「设置 → 通用 → 清空缓存 / 重开项目」。

## 技术栈

- Taro + React 小程序（目标平台：微信 `dist/` 经开发者工具编译）。
- 样式用 Tailwind，经 `weapp-tailwindcss` 编译为小程序 `.wxss`。

## 已知坑（改动相关文件时务必注意）

- **`space-y` / `divide-y` 在微信 WXSS 中无效**：其生成 CSS 使用逻辑属性
  `margin-block-start` / `:not([hidden])` 属性选择器，WXSS 不支持；且选择器要求直接子节点。
  间距请改用显式 `mb-*` / `mt-*` 等物理属性工具类。
- **自定义 tabBar（底边栏）**：`src/custom-tab-bar` 渲染 `src/components/CustomTabBar`，
  状态（选中/未读/主题/Modal 覆盖）来自模块级全局 store。
  tabBar 必须用普通 `View`（非 `CoverView`），隐藏用 `display:none`（而非 `opacity`），
  否则 `opacity:0` 的 CoverView 仍会拦截底部触摸，导致 Modal 底部按钮点不到。
- Modal 通过 `useLayoutEffect` 在绘制前隐藏 tabBar（`src/components/ui/Modal.tsx`）。
