# AGENTS.md

项目说明与协作规则（agent 必须遵守）。

## 交付闸门（Delivery Gate）

每次声明「完成 / 交付」前，必须依次执行且**全部通过（全绿）**才允许交付；任一环节失败不得宣告完成：

1. 重新构建：`pnpm build:weapp`
2. 类型检查：`pnpm typecheck`
3. 代码规范：`pnpm lint`
4. 单元测试：`pnpm test`
交付时请提醒用户在开发者工具中点一次「设置 → 通用 → 清空缓存 / 重开项目」。

## 技术栈

- Taro + React 小程序（目标平台：微信 `dist/` 经开发者工具编译）。
- 样式用 Tailwind，经 `weapp-tailwindcss` 编译为小程序 `.wxss`。

## 多语言 / 国际化设计原则（i18n）

- **文案集中、禁止硬编码**：所有面向用户的可见字符串（标题、按钮、错误提示、空态、占位、tab 文案等）一律经 `t()` 取词；不要在组件/样式里写死中文字面量（否则英文模式会残留中文）。
- **按页分文件**：`src/i18n/messages/<locale>/<page>.ts`（如 `common` / `profile` / `community`），由 `<locale>/index.ts` 聚合为 `export const <locale> = { common, profile, community }`。新增页面文案 = 加一个页文件并在聚合处引入。
- **基准语言 = `zh-CN`**：`en/index.ts` 必须 `export const en: typeof zhCN = {...}`，以 `zhCN` 的类型约束——**缺 key / 多 key 都会编译报错**，这是「漏翻必现」的硬保障。
- **取词方式**：`const { t } = useT()`；key 为点分路径如 `t('profile.settings.language')`，类型 `Path<ZHCNMessages>` 提供自动补全 + 编译期校验。
- **插值而非拼接**：动态内容用 `t('welcome', { name })`（`{name}` 占位），不要把变量拼进字符串后再翻译。
- **加载策略**：`zh-CN` 与 `en` 均静态打包进主包（`zh-CN` 为默认避免首屏闪烁；`en` 为高频第二语言，动态 `import()` 会导致英文用户冷启动短暂中文闪，故也静态引入）。更低频的新语言再加 `import()` 动态分包；语言切换由 `LanguageProvider` 统一处理并全局重渲染。
- **缺词回退**：`t()` 在 key 缺失时回退到 key 本身（便于发现未翻）；生产环境不应出现裸 key。
- **语言选择**：默认**跟随系统**（`Taro.getAppBaseInfo().language`，以 `en` 开头视为英文），手动选择存 `Taro` storage 持久化；入口在「我的 → 设置栏 → 语言」。
- **Provider 挂载**：`LanguageProvider` 已在 `src/app.ts` 的 `ThemeProvider` 内层；正常页面已处于其内，直接用 `useT()`，无需额外包裹。
- **新增语言**：在 `Locale` 联合类型与 `loaders` 各加一项，并新建 `messages/<locale>/*` 按页补齐即可，**不引入新依赖**。
- **单测**：纯逻辑用已导出的 `translate(dict, key, params)`；组件依赖 `useT` 时 `vi.mock('@/i18n', () => ({ useT: () => ({ t: (k) => k, locale: 'zh-CN', setLocale: vi.fn() }) }))`。
- **底边栏 tab 文案**：`src/components/CustomTabBar.tsx` 的 `LIST` 文本目前为硬编码中文（class 组件），需翻译时单独处理（可走模块 store 或包装 hook），不属于页面 `t()` 范围。

## 已知坑（改动相关文件时务必注意）

- **`space-y` / `divide-y` 在微信 WXSS 中无效**：其生成 CSS 使用逻辑属性
  `margin-block-start` / `:not([hidden])` 属性选择器，WXSS 不支持；且选择器要求直接子节点。
  间距请改用显式 `mb-*` / `mt-*` 等物理属性工具类。
- **自定义 tabBar（底边栏）**：`src/custom-tab-bar` 渲染 `src/components/CustomTabBar`，
  状态（选中/未读/主题/Modal 覆盖）来自模块级全局 store。
  tabBar 必须用普通 `View`（非 `CoverView`），隐藏用 `display:none`（而非 `opacity`），
  否则 `opacity:0` 的 CoverView 仍会拦截底部触摸，导致 Modal 底部按钮点不到。
- **tabBar 遮挡：所有 tab 页根容器必须「内联」预留真实 50px**：底边栏是
  `position: fixed; bottom: 0; height: calc(50px + env(safe-area-inset-bottom))` 的浮层
  （见 `src/components/CustomTabBar.tsx`）。页面根用
  `style={{ paddingBottom: 'calc(50px + env(safe-area-inset-bottom))' }}`（真实 px）预留同样高度，
  否则滚动内容末行会被永久遮挡、滚不到底。已在 index / community / members / profile / schedule
  五个 tab 页根应用此内联预留。
  **关键坑：Taro 会把样式表（`.wxss`、Tailwind 工具类、`@utility`、`pb-[50px]` 等）里的 `px`
  自动编译成 `rpx`**（`50px`→`50rpx`≈25px）；而 tabBar 高度用的是**内联** `px`（不被转换）。所以写在
  `app.css` / `className` 里的 `50px` 只留一半高度、照样遮挡——**只能在内联 `style` 里写真实 `px`**。
  历史写法 `pb-safe`（仅安全区）、`pb-8`、`pb-[50px]` 均不足或被转 rpx，已废弃。
- Modal 通过 `useLayoutEffect` 在绘制前隐藏 tabBar（`src/components/ui/Modal.tsx`）。
- **新建页面必须有 `index.scss`（并 import）**：Taro 仅在页面 `import './index.scss'`
  且该文件有真实内容时才生成 `dist/.../index.wxss`；缺省会导致微信开发者工具报
  `ENOENT ... index.wxss`（页面需要样式文件，即使为空也要有）。因此新建页面时务必
  创建 `src/pages/<page>/index.scss`（可放一条占位规则如 `.pk-page { min-height: 100vh; }`）
  并在页面 `tsx` 顶部 `import './index.scss'`。
- **`Input` / `Textarea` 必须用 `View` 包裹以约束宽度**：小程序原生 `Input`/`Textarea`
  直接写 `w-full` 等仍可能撑破父容器、超出画面。统一用「外层 `View`（承载边框/圆角/
  背景，带 `w-full overflow-hidden`）包住内层 `Input`/`Textarea`（内层用
  `w-full bg-transparent`，高度如 `h-10`）」的写法（参考 `src/pages/login/index.tsx`
  的邮箱/密码框）。改动表单页时务必沿用此模式，避免输入框溢出。
