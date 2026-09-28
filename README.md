# pkuso-miniprogram

PKUSO 微信小程序（成员端 / member end）。基于 **Taro + React + TypeScript**，样式用 **Tailwind**（经 `weapp-tailwindcss` 编译为小程序 `.wxss`），数据层对接 **Supabase**。

目标产物：`dist/`（微信小程序代码），经「微信开发者工具」编译预览 / 上传。

> **协作规则、CI 行为、版本号与分支流程以 [`AGENTS.md`](./AGENTS.md) 为准。** 本文只做概览，两者冲突时以 `AGENTS.md` 为准。

## 技术栈

- Taro `4.2.x` + React `18` + TypeScript `5`
- Tailwind CSS `4`（小程序侧由 `weapp-tailwindcss` 转译）
- `@supabase/supabase-js`（微信端用 `taroFetch` 适配）
- Vitest + @testing-library/react（jsdom 环境）做单元测试

## 环境要求

- Node `22+`（与 CI 一致）
- pnpm `11`（与仓库 `pnpm-lock.yaml` 对齐；CI 同版本）

## 安装与配置

```bash
pnpm install
cp .env.example .env.development   # 本地开发
cp .env.example .env.production    # 生产构建（上传前填写）
```

`.env.*` 中以 `TARO_APP_` 前缀的变量会被 Taro 注入到 `process.env`，供小程序运行时读取：

| 变量                         | 说明                                         | 来源                                         |
| ---------------------------- | -------------------------------------------- | -------------------------------------------- |
| `TARO_APP_SUPABASE_URL`      | Supabase 项目地址                            | 同 `pkuso-web` 的 `NEXT_PUBLIC_SUPABASE_URL` |
| `TARO_APP_SUPABASE_ANON_KEY` | Supabase publishable key（公开设计，不入库） | 同 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`    |
| `TARO_APP_SESSION_DIAG`      | 会话诊断日志开关：`1` 开 / `0` 关            | 本地排障用                                   |

## 常用脚本

| 命令               | 作用                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `pnpm dev:weapp`   | **开发环境**构建到 `dist/`（`NODE_ENV=development`，读 `.env.development`；**不是 watch 模式**） |
| `pnpm build:weapp` | **生产环境**构建到 `dist/`（读 `.env.production`，**指向生产库**）                               |
| `pnpm typecheck`   | `tsc --noEmit`                                                                                   |
| `pnpm lint`        | ESLint（`--max-warnings 0`）                                                                     |
| `pnpm test`        | Vitest 单测                                                                                      |
| `pnpm format`      | Prettier 检查（`pnpm format:fix` 自动修）                                                        |
| `pnpm verify`      | `format && lint && typecheck && test`（本地便利命令，**不含构建、CI 也不跑它**）                 |
| `pnpm pull-types`  | 从本地 `../pkuso-backend` 复制 `database.types.ts`                                               |
| `pnpm upload`      | 手动上传 `dist/` 到微信（见 `AGENTS.md` §3.4）                                                   |
| `pnpm new`         | 创建新页面/组件                                                                                  |

> 版本号、分支、CI 相关命令（`version:*` / `branch:create`）见 `AGENTS.md` §2。

## 交付闸门（Delivery Gate）

每次声明「完成 / 交付」前，必须依次执行且**全部通过**才允许交付：

1. 构建 `pnpm build:weapp`
2. 类型检查 `pnpm typecheck`
3. 代码规范 `pnpm lint`
4. 单元测试 `pnpm test`

交付后请在微信开发者工具中点一次「设置 → 通用 → 清空缓存 / 重开项目」，避免旧包缓存。

注意：CI 的步骤是 `lint → typecheck → test → build`（集合相同、顺序不同），且 **CI 不跑 `pnpm format`**。

## ⚠️ 本地构建连的是哪个环境

`build:weapp` 读 `.env.production`（**生产库**），`dev:weapp` 读 `.env.development`（开发库）。跑完闸门留下的 `dist/` 是连生产库的——**在开发者工具里登录、点数据之前先确认环境**。详见 `AGENTS.md` §1.3。

## 目录结构

```
src/
  pages/           各页面（每页须含 index.scss，否则包裹层高度兜底会失效）
  components/       业务组件
    ui/            通用 UI（Modal / Toggle / StatusChip / ActionBar / FieldRow / ListState …）
    CustomTabBar.tsx  底边栏（class 组件，状态来自模块级全局 store）
  hooks/           数据/逻辑 hooks（useAttendance / useProfiles / usePosts / useNotifications …）
  lib/             纯函数与基础设施（supabase 适配、i18n 核心、geo、contentModeration、dataSync …）
  context/         React Context（ThemeProvider / user-context / LanguageProvider 经 i18n）
  i18n/            国际化（见下）
  custom-tab-bar/  自定义 tabBar 渲染入口（必须用普通 View，隐藏用 display:none）
src/types/database.types.ts   Supabase 生成的类型（由 pkuso-backend CI 同步，勿手改）
config/index.ts    Taro 构建配置（defineConstants 注入 APP_VERSION）
```

## 国际化（i18n）

- 所有面向用户可见字符串经 `t()` 取词，禁止在组件/样式里硬编码中文。
- 文案按页分文件：`src/i18n/messages/<locale>/<page>.ts`，由 `<locale>/index.ts` 聚合。
- **`zh-CN` 与 `en` 都静态打包**进主包（`en` 若动态加载会让英文用户冷启动闪中文）。取词：`const { t } = useT()`，`t('profile.settings.language')` 受 `Path<ZHCNMessages>` 类型校验，缺 key / 多 key 编译报错。
- 默认跟随系统语言（`Taro.getAppBaseInfo().language`，以 `en` 开头视为英文），手动选择存 storage。入口：「我的 → 设置 → 语言」。

## CI/CD（摘要）

| 分支          | push 后 CI 做什么                                                                |
| ------------- | -------------------------------------------------------------------------------- |
| `dev`         | verify（lint → typecheck → test → build）→ 上传到微信**开发版本**列表（robot 1） |
| `main`        | 同上（robot 2）→ 版本号回写 `main` + 推 tag `v<version>`                         |
| 其他分支 / PR | **不触发任何 CI**（workflow 只监听 push 到 dev/main，且有 `paths:` 白名单）      |

**CI 只上传代码包，不发布正式版**——「提交审核 → 发布」必须人工在微信公众平台操作。完整机制见 `AGENTS.md` §3。

## 已知坑（改动相关文件务必注意）

详见 [`AGENTS.md`](./AGENTS.md) §7，要点：

- `space-y-*` / `divide-y-*` 在微信 `WXSS` 中无效（编译为不被支持的 `margin-block-start` / 属性选择器），间距改用显式 `mb-*` / `mt-*`。
- 自定义 tabBar 必须用普通 `View`（非 `CoverView`），隐藏用 `display:none`，否则 `opacity:0` 的 CoverView 仍会拦截底部触摸。
- tab 页根容器必须用**内联** `style` 预留 `calc(50px + env(safe-area-inset-bottom))`：Taro 会把样式表里的 `px` 转成 `rpx`（减半），只有内联 `px` 才是真 px。
- `Input` / `Textarea` 必须用外层 `View`（`w-full overflow-hidden`）包裹内层（`w-full bg-transparent`），否则可能撑破父容器。
- 新建页面必须有 `src/pages/<page>/index.scss` 并在页面里 `import`（哪怕空的也要——它决定 Taro 是否给包裹层注入 `.page{height:100%}`）。

## 相关仓库

- `pkuso-web`：Web 管理端（Next.js），Supabase 配置与小程序同源。
- `pkuso-backend`：数据库 schema / RLS / Edge Functions 的唯一事实来源。
