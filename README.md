# pkuso-miniprogram

PKUSO 微信小程序（成员端 / member end）。基于 **Taro + React + TypeScript**，样式用 **Tailwind**（经 `weapp-tailwindcss` 编译为小程序 `.wxss`），数据层对接 **Supabase**。

目标产物：`dist/`（微信小程序代码），经「微信开发者工具」编译预览 / 上传。

## 技术栈

- Taro `4.2.x` + React `18` + TypeScript `5`
- Tailwind CSS `4`（小程序侧由 `weapp-tailwindcss` 转译）
- `@supabase/supabase-js`（微信端用 `taroFetch` 适配）
- Vitest + @testing-library/react（jsdom 环境）做单元测试

## 环境要求

- Node `20+`
- pnpm `11`（与仓库 `pnpm-lock.yaml` 对齐；CI 同版本）

## 安装与配置

```bash
pnpm install
cp .env.example .env.development   # 本地开发
cp .env.example .env.production    # 生产构建（上传前填写）
```

`.env.*` 中以 `TARO_APP_` 前缀的变量会被 Taro 注入到 `process.env`，供小程序运行时读取：

| 变量 | 说明 | 来源 |
| --- | --- | --- |
| `TARO_APP_SUPABASE_URL` | Supabase 项目地址 | 同 `pkuso-web-v2` 的 `NEXT_PUBLIC_SUPABASE_URL` |
| `TARO_APP_SUPABASE_ANON_KEY` | Supabase publishable key（公开设计，不入库） | 同 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| `TARO_APP_SESSION_DIAG` | 会话诊断日志开关：`1` 开 / `0` 关 | 本地排障用 |

## 常用脚本

| 命令 | 作用 |
| --- | --- |
| `pnpm dev:weapp` | 监听模式构建到 `dist/`（配合开发者工具热重载） |
| `pnpm build:weapp` | 生产构建到 `dist/` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint（`--max-warnings 0`） |
| `pnpm test` | Vitest 单测 |
| `pnpm verify` | `format && lint && typecheck && test`（仓库级一致性检查） |

## 交付闸门（Delivery Gate）

每次声明「完成 / 交付」前，必须依次执行且**全部通过**才允许交付：

1. 重新构建 `pnpm build:weapp`
2. 类型检查 `pnpm typecheck`
3. 代码规范 `pnpm lint`
4. 单元测试 `pnpm test`

交付后请在微信开发者工具中点一次「设置 → 通用 → 清空缓存 / 重开项目」，避免旧包缓存。

## 目录结构

```
src/
  pages/           各页面（每页须含 index.scss，否则开发者工具报 index.wxss 缺失）
  components/       业务组件
    ui/            通用 UI（Modal / Toggle / StatusChip / ActionBar / FieldRow / ListState …）
    CustomTabBar.tsx  底边栏（class 组件，状态来自模块级全局 store）
  hooks/           数据/逻辑 hooks（useAttendance / useProfiles / usePosts / useNotifications …）
  lib/             纯函数与基础设施（supabase 适配、i18n 核心、geo、contentModeration、dataSync …）
  context/         React Context（ThemeProvider / user-context / LanguageProvider 经 i18n）
  i18n/            国际化（见下）
  custom-tab-bar/  自定义 tabBar 渲染入口（必须用普通 View，隐藏用 display:none）
src/types/database.types.ts   Supabase 生成的类型
config/index.ts    Taro 构建配置（defineConstants 注入 APP_VERSION）
```

## 国际化（i18n）

- 所有面向用户可见字符串经 `t()` 取词，禁止在组件/样式里硬编码中文。
- 文案按页分文件：`src/i18n/messages/<locale>/<page>.ts`，由 `<locale>/index.ts` 聚合。
- 基准语言 `zh-CN` 静态打包；其余语言（如 `en`）由 `loaders` 动态加载。取词：`const { t } = useT()`，`t('profile.settings.language')` 受 `Path<ZHCNMessages>` 类型校验，缺 key / 多 key 编译报错。
- 默认跟随系统语言（`Taro.getAppBaseInfo().language`，以 `en` 开头视为英文），手动选择存 storage。入口：「我的 → 设置 → 语言」。

## 已知坑（改动相关文件务必注意）

详见仓库 `AGENTS.md`，要点：

- `space-y-*` / `divide-y-*` 在微信 `WXSS` 中无效（编译为不被支持的 `margin-block-start` / 属性选择器），间距改用显式 `mb-*` / `mt-*`。
- 自定义 tabBar 必须用普通 `View`（非 `CoverView`），隐藏用 `display:none`，否则 `opacity:0` 的 CoverView 仍会拦截底部触摸。
- `Input` / `Textarea` 必须用外层 `View`（`w-full overflow-hidden`）包裹内层（`w-full bg-transparent`），否则可能撑破父容器。
- 新建页面必须有 `src/pages/<page>/index.scss`（哪怕一条占位规则），否则开发者工具报 `ENOENT ... index.wxss`。

## 相关仓库

- `pkuso-web-v2`：Web 管理端（Next.js），Supabase 配置与小程序同源。
