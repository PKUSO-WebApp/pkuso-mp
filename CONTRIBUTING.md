# 贡献指南

PKUSO 微信小程序（成员端）开发规范与贡献流程。

> **协作规则、CI 行为、版本号与分支流程的完整说明见 [`AGENTS.md`](./AGENTS.md)**（其 §1 是「拿到任务先读」的那一节）。本文与它冲突时以 `AGENTS.md` 为准。

## 快速开始

### 环境要求

- Node.js 22+
- pnpm 11
- 微信开发者工具

### 安装

```bash
pnpm install
cp .env.example .env.development
```

### 本地开发

```bash
pnpm dev:weapp
```

在微信开发者工具中导入 `dist/` 目录预览。

**`pnpm dev:weapp` 不是 watch 模式**——它是一次性构建（`NODE_ENV=development taro build --type weapp`），改完代码要重新运行。

> ⚠️ 反过来，`pnpm build:weapp` 读的是 `.env.production`，**构建产物连的是生产库**。在开发者工具里登录、翻数据之前先确认手上这份 `dist/` 是哪个环境构建的（详见 `AGENTS.md` §1.3）。

## 项目结构

```
src/
  pages/            页面（每页必须有 index.scss）
  components/       业务组件
    ui/             通用 UI 组件
  hooks/            数据/逻辑 hooks
  lib/              纯函数与基础设施
  context/          React Context
  i18n/             国际化文案
  custom-tab-bar/   自定义 tabBar 渲染入口
```

## 常用命令

| 命令               | 说明                                                                             |
| ------------------ | -------------------------------------------------------------------------------- |
| `pnpm dev:weapp`   | 开发环境构建（读 `.env.development`；**一次性构建，不是 watch 模式**）           |
| `pnpm build:weapp` | 生产环境构建（读 `.env.production`，**指向生产库**）                             |
| `pnpm typecheck`   | TypeScript 类型检查                                                              |
| `pnpm lint`        | ESLint（零警告）                                                                 |
| `pnpm test`        | Vitest 单测                                                                      |
| `pnpm format:fix`  | Prettier 格式化                                                                  |
| `pnpm verify`      | format + lint + typecheck + test（本地便利命令：**不含构建，CI 也不跑 format**） |
| `pnpm pull-types`  | 从本地 `../pkuso-backend` 复制 `database.types.ts`                               |
| `pnpm new`         | 创建新页面/组件                                                                  |

> 版本号与分支脚本（`version:*` / `branch:create`）的用法与坑见 `AGENTS.md` §2。

## 交付闸门

每次声明「完成」前必须通过：

```bash
pnpm gate
```

**闸门的唯一定义在 `scripts/gate.mjs`**，CI 与人都调它（详见 `AGENTS.md` §1.2）。它会跑完检查与生产构建后，**自动再出一份连开发库的 `dist/`** 并核对，然后打印验收指引——所以在开发者工具里打开的永远是开发库版本。

通过后在微信开发者工具中「设置 → 通用 → 清空缓存 / 重开项目」（脚本会提醒）。

> **CI 不跑 `pnpm format`**——`pnpm verify` 只是本地便利命令，不等于 CI。

## 代码规范

### 格式化

- 无分号（`semi: false`）
- 单引号（`singleQuote: true`）
- 行宽 100
- 尾逗号 `es5`
- 缩进 2 空格
- 换行符 `lf`

### TypeScript

- 严格空值检查
- 路径别名：`@/*` → `./src/*`
- 禁止未使用的局部变量和参数

### ESLint

- 扩展 `taro/react`
- 零警告（`--max-warnings 0`）

### 提交消息

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
<type>: <description>
```

常用类型：`feat`、`fix`、`docs`、`style`、`refactor`、`test`、`chore`、`ci`

示例：

```
feat: 添加消息通知功能
fix: 修复登录页冷启动闪烁
chore: bump version to 0.2.1
```

## 国际化（i18n）

所有面向用户的可见字符串必须经 `t()` 取词，禁止硬编码中文。

```tsx
const { t } = useT()
<Text>{t('profile.settings.language')}</Text>
```

- 文案文件：`src/i18n/messages/<locale>/<page>.ts`
- 基准语言 `zh-CN`，英文 `en` 静态打包
- 动态内容用插值：`t('welcome', { name })`
- 新增语言：在 `Locale` 联合类型与 `loaders` 各加一项，按页补齐文案

## 已知坑

### `space-y` / `divide-y` 在 WXSS 中无效

这些 Tailwind 类生成的 CSS 使用逻辑属性，WXSS 不支持。改用 `mb-*` / `mt-*` 等物理属性。

### 自定义 tabBar

必须用普通 `View`（非 `CoverView`），隐藏用 `display:none`（非 `opacity`）。

### tabBar 遮挡

所有 tab 页根容器必须内联预留高度：

```tsx
<View style={{ paddingBottom: 'calc(50px + env(safe-area-inset-bottom))' }}>
```

**不能用 className 中的 `px`**——Taro 会把样式表中的 `px` 自动编译为 `rpx`（减半），只有内联 `style` 保留真实 `px`。

### 新建页面必须有 `index.scss`

即使为空也要创建，并在页面 `tsx` 中 `import './index.scss'`。它决定 Taro 是否给页面包裹层注入 `.page{height:100%}`——缺了这层，短内容页面会高度塌陷、露出窗口背景色（`src/app.css` 有一段全局兜底，但别依赖它去补每个新页面）。

### Input /Textarea 必须用 View 包裹

```tsx
<View className='w-full overflow-hidden rounded-xl border'>
  <Input className='w-full bg-transparent' />
</View>
```

## 测试

- 框架：Vitest + @testing-library/react
- 测试文件：`src/**/*.test.{ts,tsx}`
- 纯逻辑：导出函数直接测试
- 组件/Hooks：mock `useT`、Supabase 等依赖

```bash
pnpm test
```

## 分支与 CI/CD

### 分支策略

| 分支     | 用途                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------- |
| `main`   | 稳定发布基线。push 后 CI 自动 version:release → build → upload（robot 2）→ 版本号回写 + 推 tag |
| `dev`    | 开发测试基线。push 后 CI 自动 version:dev → build → upload（robot 1）                          |
| 功能分支 | 从 `dev` 创建，squash merge 回 `dev`                                                           |

### 创建功能分支

```bash
pnpm branch:create <patch|minor|major> "描述"
```

它会建分支、改 `package.json` 版本、提交一次、建本地 tag。**两个坑见 `AGENTS.md` §2.3**（版本号带 `-dev.N` 后缀时会写出 `0.4.NaN`；那次 `package.json` 提交会跟着合进 `dev`）。

### 开发流程

1. `pnpm branch:create patch 修复bug` — 创建分支
2. `pnpm dev:weapp` — 本地开发（改完要重新构建，非 watch）
3. `pnpm build:weapp && pnpm typecheck && pnpm lint && pnpm test` — 本地闸门
4. squash merge 到 `dev` 并 `git push origin dev` — CI 自动构建并上传到微信**开发版本**列表（robot 1）
5. 测试通过后 merge 到 `main` — CI 再上传一份（robot 2），版本号回写 `main` 并推 tag

⚠️ **CI 只上传代码包，不发布正式版。** 上线正式版仍需人工在微信公众平台「提交审核 → 发布」。
⚠️ **开 PR 不触发任何 CI**：workflow 只监听 `push` 到 `dev` / `main`，且有 `paths:` 白名单（改 `.md` 不触发，改 `package.json` 会触发一次真实上传）。详见 `AGENTS.md` §3。

### 环境要求（CI）

- pnpm 11, Node 22
- `--frozen-lockfile` 安装
- `shamefully-hoist=true`（`.npmrc`）

## 相关仓库

- `pkuso-web`：Web 管理端（Next.js），Supabase 配置同源
