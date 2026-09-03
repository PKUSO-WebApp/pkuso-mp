# 贡献指南

PKUSO 微信小程序（成员端）开发规范与贡献流程。

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

| 命令 | 说明 |
|------|------|
| `pnpm dev:weapp` | 监听构建（配合开发者工具热重载） |
| `pnpm build:weapp` | 生产构建 |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm lint` | ESLint（零警告） |
| `pnpm test` | Vitest 单测 |
| `pnpm format:fix` | Prettier 格式化 |
| `pnpm verify` | 完整校验：format + lint + typecheck + test |
| `pnpm new` | 创建新页面/组件 |

## 交付闸门

每次声明「完成」前，必须全部通过：

```bash
pnpm build:weapp
pnpm typecheck
pnpm lint
pnpm test
```

通过后在微信开发者工具中「设置 → 通用 → 清空缓存 / 重开项目」。

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

即使为空也要创建，并在页面 `tsx` 中 `import './index.scss'`，否则开发者工具报 `ENOENT ... index.wxss`。

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

| 分支 | 用途 |
|------|------|
| `main` | 稳定发布，CI 自动 version:release → build → upload |
| `dev` | 开发测试，CI 自动 version:dev → build → upload |
| 功能分支 | 从 `dev` 创建，squash merge 回 `dev` |

### 创建功能分支

```bash
pnpm branch:create <patch|minor|major> "描述"
```

### 开发流程

1. `pnpm branch:create patch 修复bug` — 创建分支
2. `pnpm dev:weapp` — 本地开发
3. `pnpm verify` — 本地校验
4. squash merge 到 `dev` — `git push origin dev` 触发 CI 自动上传开发版
5. 测试通过后 merge 到 `main` — CI 自动发布正式版

### 环境要求（CI）

- pnpm 11, Node 22
- `--frozen-lockfile` 安装
- `shamefully-hoist=true`（`.npmrc`）

## 相关仓库

- `pkuso-web-v2`：Web 管理端（Next.js），Supabase 配置同源
