# AGENTS.md

项目说明与协作规则（agent 必须遵守）。

**拿到任务先读第 1 节**——它回答「我该在哪个分支做什么、推上去会发生什么、什么算完成」。后面几节按需查。

## 0. 这个仓库是什么

- 微信小程序（成员端）。Taro 4 + React 18 + TypeScript + Tailwind 4（经 `weapp-tailwindcss` 编译成 WXSS）+ Supabase。
- 产物：`dist/`（已 gitignore），由微信开发者工具打开，或由 CI / `pnpm upload` 上传。
- 关联仓库：
  - `../pkuso-backend` —— **数据库 schema / RLS / 函数 / Edge Functions 的唯一事实来源**；其约定见该仓库根目录 `CLAUDE.md`。
  - `../pkuso-web` —— Web 管理端（设计原则的参照系）。

---

## 1. 工作流程（先读这一节）

### 1.1 我该在哪个分支，推上去会发生什么

| 分支 | 是什么 | push 之后 |
| --- | --- | --- |
| `dev` | 日常开发与测试基线 | 触发 `Deploy to WeChat Dev`：verify → 构建 → **上传到微信「开发版本」列表（robot 1 槽位）** |
| `main` | 稳定发布基线 | 触发 `Deploy to WeChat Prod`：verify → 构建 → **上传到微信「开发版本」列表（robot 2 槽位）** → 版本号提交回 `main` + 推 tag |
| 功能分支 | 从 `dev`（或 `main`）拉出 | **不触发任何 CI** |
| `master` | 历史遗留，别用 | —— |

⚠️ 三条必须知道的事实：

1. **CI 只监听 `push` 到 `dev` / `main`，`pull_request` 不触发任何 workflow。** 开 PR 不会跑检查；想过闸门只能先推上去，失败后再补修复提交。所以本地闸门（§1.2）尽量一次跑干净。
2. **CI 有 `paths:` 白名单**（清单见 §3.2）。改 `AGENTS.md` / `README.md` / `docs/**` / `.env*` **不触发 CI**；改 `package.json` / `src/**` / `scripts/**` **会触发一次真实构建与上传**——所以「顺手改一下 `version`」不是无副作用操作。
3. **`main` 的现状并不等于「只接受从 dev 合并」**：历史里既有从 `dev` 合入，也有直接推 `main`、以及功能分支直接 merge 到 `main`。规范意图是 dev 先行，但别拿这句话去推断历史或断言别人做错了。

### 1.2 交付闸门（Delivery Gate）

声明「完成 / 交付」前必须依次执行且全绿。**这是本仓库唯一的闸门定义**，`README.md` / `CONTRIBUTING.md` 与 CI 都以此为准：

```bash
pnpm build:weapp     # 1. 构建必须过
pnpm typecheck       # 2. tsc --noEmit
pnpm lint            # 3. eslint --max-warnings 0
pnpm test            # 4. vitest run
```

交付后请提醒用户在开发者工具中点一次「设置 → 通用 → 清空缓存 / 重开项目」。

两处容易记混的地方：

- **CI 不跑 `pnpm format`。** `pnpm verify`（= `format && lint && typecheck && test`）只是本地便利命令，**不等于 CI**；格式化请自己跑 `pnpm format:fix`。
- **CI 的顺序是 install → lint → typecheck → test → build**：集合与上表相同，但顺序不同（CI 把构建放最后）。

> `pnpm dev:weapp` 与 `pnpm build:weapp` **都不是 watch 模式**，两者都是一次性构建，区别只在注入的环境变量（见 §1.3）。闸门与 CI 统一用 `build:weapp`。

### 1.3 ⚠️ 本地构建默认连的是**生产库**

| 命令 | `NODE_ENV` | 读取的 env 文件 | 指向的 Supabase |
| --- | --- | --- | --- |
| `pnpm build:weapp` | `production` | `.env.production` | **生产项目** |
| `pnpm dev:weapp` | `development` | `.env.development` | 开发项目 |
| `NODE_ENV=development pnpm build:weapp` | `development` | `.env.development` | 开发项目 |

- env 文件由 Taro 按 `NODE_ENV` 选择；`NODE_ENV=development` 时 `config/index.ts` 额外 merge `config/dev.ts`。
- `.env.development` / `.env.production` **都不入库**（`.gitignore`），CI 从 secrets 写出这两份文件。本地要构建得先有（`cp .env.example .env.development` 后填值）。

**所以在开发者工具里点登录、翻数据之前，先确认 `dist/` 是哪个环境构建的。** 刚跑完闸门的 `build:weapp` 留下的是一个**连生产库**的 `dist/`；要调试先补一次 `pnpm dev:weapp`。

核对方法：

```bash
grep -rl "$(grep -m1 TARO_APP_SUPABASE_URL .env.development | cut -d= -f2)" dist   # 有命中 = 当前是开发库
```

### 1.4 提交规范

- **Conventional Commits**，由 husky + commitlint 强制（`.husky/commit-msg`）：`<type>: <描述>`。
- 常用 type：`feat` `fix` `docs` `style` `refactor` `test` `chore` `ci`。
- 描述用中文（沿用本仓库历史）。
- 没有配置 `lint-staged`，提交前不会自动跑 lint / format——闸门得自己跑。

---

## 2. 版本号管理

**单一事实来源 = `package.json` 的 `version`。** 构建时由 `config/index.ts` 注入为全局常量 `APP_VERSION`，显示在「我的」页脚与「问题与反馈」弹窗。它与微信后台的上传版本号是两回事。

### 2.1 本地脚本（`scripts/version.js`，只改 `package.json`，不碰 git）

```bash
node scripts/version.js          # 只打印当前版本
```

| 命令 | 效果 | 场景 |
| --- | --- | --- |
| `pnpm version:dev` | `0.4.26` → `0.4.26-dev.1` | 开发期标记 |
| `pnpm version:rc` | → `0.4.26-rc.1` | 准备提审 |
| `pnpm version:release` | `0.4.26-rc.1` → `0.4.26` | 去预发布后缀 |
| `pnpm version:bump` | `0.4.26` → `0.4.27` | patch 升级 |
| `pnpm version:minor` | → `0.5.0` | 次版本 |
| `pnpm version:major` | → `1.0.0` | 主版本 |

### 2.2 ⚠️ 大多数情况下你**不该**手动改版本号

因为 **CI 会在部署时重写它**：

- `dev`：`DEV_VERSION_NUM=${{ github.run_number }} pnpm version:dev` → 版本变成 `<package.json 里的基础版本>-dev.<run_number>`（如 `0.4.26-dev.37`）。**不提交回去**，每次推送重算。
- `main`：`pnpm version:release` → 去掉预发布后缀，然后以 `chore: release <version> [skip ci]` **提交回 `main`**，并推 tag `v<version>`。

推论：

- 在功能分支里改 `version`，合到 `dev` / `main` 后基本会被 CI 覆盖——**除非你要改的正是「基础版本号」那一段**（`0.4.26` 里的 `0.4`）。
- 想发新版：正常改代码 → 合 `dev` → 验证 → 合 `main`。版本号与上传都交给 CI，不要手工模拟。

### 2.3 ⚠️ `pnpm branch:create` 的两个坑

```bash
pnpm branch:create <patch|minor|major> <描述>
# 例：pnpm branch:create patch 修复登录bug
```

它依次做四件事：按 `<type>/<描述>` 建分支 → 改 `package.json` 版本 → 提交 `chore: bump version to X` → 建**本地** tag `vX`（不推送）。

1. **版本号带预发布后缀时它算错。** `scripts/create-branch.js` 用 `version.split('.').map(Number)`，遇到 `0.4.26-dev.1` 会得到 `patch = NaN`，把版本写成 **`0.4.NaN`**（`scripts/version.js` 能正确处理，两者行为不一致）。**所以别在 `pnpm version:dev` 之后跑 `branch:create`**；单纯要升版本用 `pnpm version:bump`。
2. **它会自己提交一次 `package.json`**，这个提交会跟着你合进 `dev` / `main`，并因此命中 CI 的 `paths:` 白名单。

### 2.4 tag

- `branch:create` 建的是**本地** tag，不推送。
- CI 的 prod 部署建并推 `v<version>`，且**先查远程是否已有同名 tag**（同一版本重复部署是常见情形），有就跳过——所以 tag 与部署不是一一对应。
- 查看：`git log --oneline --decorate` / `git log --tags --oneline`。

---

## 3. CI/CD：Deploy to WeChat 到底做了什么

两个 workflow：`.github/workflows/deploy-dev.yml`（`dev`）、`deploy-prod.yml`（`main`）。环境：pnpm 11、Node 22、`pnpm install --frozen-lockfile`。

### 3.1 步骤对照

| | `dev` | `main` |
| --- | --- | --- |
| verify job（两个 workflow 相同） | `pnpm lint` → `pnpm typecheck` → `pnpm test` → 构建 | 同左 |
| 构建前写 env | `.env.development`（secrets `DEV_SUPABASE_URL` / `DEV_SUPABASE_ANON_KEY`） | `.env.production`（`PROD_SUPABASE_URL` / `PROD_SUPABASE_ANON_KEY`） |
| 版本号 | `DEV_VERSION_NUM=<run_number> pnpm version:dev` | `pnpm version:release` |
| 构建命令 | `NODE_ENV=development pnpm build:weapp` | `pnpm build:weapp` |
| 上传 | `node scripts/upload.js`，**robot 1** | 同左，**robot 2** |
| 收尾 | —— | 版本号提交回 main（`[skip ci]`）+ 推 tag `v<version>`（远程已有则跳过） |

**两个 workflow 的 upload 步骤都只是「上传代码包」，都不发布版本。** 产物落进微信公众平台的**开发版本**列表；「提交审核」与「发布」没有开放 API，必须人工在平台上操作。所以：

- 合 `dev` → 开发版本列表多一份代码（robot 1 槽位），可设为体验版；
- 合 `main` → 开发版本列表多一份代码（robot 2 槽位）；
- **上线正式版仍需人工「提交审核 → 发布」**——不要以为合了 `main` 就上线了。

> robot 槽位是 `scripts/upload.js` 的机制：`ci.upload()` 没有「版本类型」参数，服务端也无法区分来源，微信把每个 robot 当作开发版列表里的独立上传位置，不同 robot 互不覆盖。不区分的话 dev 与 prod 的 CI 会互相顶掉。**别把两个 workflow 的 robot 改成同一个。**

### 3.2 触发条件

```yaml
on:
  push:
    branches: [dev]        # deploy-prod.yml 是 [main]
    paths: [src/**, config/**, scripts/**, package.json, pnpm-lock.yaml,
            .npmrc, tsconfig.json, vitest.config.ts, app.css, app.scss, .github/**]
```

- **只有 `push`，没有 `pull_request`。**
- 白名单里的 `app.css` / `app.scss` 是**无效条目**：仓库根没有 `app.css`，根的 `app.scss` 是空文件；真文件是 `src/app.css`，已被 `src/**` 覆盖。
- 不在名单里的改动（`AGENTS.md`、`README.md`、`CONTRIBUTING.md`、`docs/**`、`.env*`、`types/**`）**不触发 CI**。
- 提交信息里带 `[skip ci]` 时 workflow 会跳过（prod 的版本号回写提交就靠这个避免自触发）。

### 3.3 ⚠️ 必须监控 CI

**所有触发 CI 的操作（push / merge / workflow_dispatch），必须用 `gh run watch <run-id> --exit-status` 监控直到 CI 完成，不得提前返回。** 因为 PR 阶段没有预检，失败只能在 push 之后才发现。

### 3.4 本地手动上传（不走 CI）

```bash
pnpm upload                    # 上传 dist/（robot 1，版本取 package.json，描述为时间戳）
pnpm upload 0.4.27 "测试上传"   # 指定版本号与描述
```

需要 `key/private.key`（微信公众平台 → 开发管理 → 开发设置 → 小程序代码上传 → 生成密钥）。可用环境变量覆盖：`WX_APPID`、`WX_UPLOAD_ROBOT`、`WX_UPLOAD_VERSION`、`WX_UPLOAD_DESC`、`WX_PRIVATE_KEY_PATH`。

---

## 4. 后端修改与类型同步

所有后端变更（DDL / RLS / 函数 / 触发器 / Edge Functions）**必须提交到 `pkuso-backend` 仓库**。小程序端只持有 publishable key，**没有任何 DB 变更权限，也不要本机连库改 schema**。

- 发现后端问题 → 在 `pkuso-backend` 仓库建 Issue
- 需要新表 / 列 / 函数 → 在 `pkuso-backend` 建 PR

类型同步（`src/types/database.types.ts`）：

- 由 `pkuso-backend` 的 CI 生成，然后**直接 push 到 `pkuso-mp` 的 `dev`**（提交信息 `chore: sync database types from pkuso-backend [skip ci]`）。**不是**开 PR 等你合。
- 手动同步：`pnpm pull-types` —— 从**本地兄弟目录** `../pkuso-backend/types/database.types.ts` 直接 `cp`，不联网、不 `git pull`。所以先确保那个仓库已更新到最新；路径可用 `PKUSO_BACKEND_PATH` 覆盖。

---

## 5. 技术栈

- Taro 4.2 + React 18 + TypeScript 5，目标平台：微信（`pnpm build:weapp` 产出 `dist/`，经开发者工具编译预览）。
- 样式用 Tailwind 4，经 `weapp-tailwindcss` 编译为小程序 `.wxss`（`config/index.ts` 的 `cssEntries` 指向 `src/app.css`）。
- 组件一律用 Taro 组件（`View` / `Text` / `Image` / `Button` / `Input`），不要 `div` / `span`。
- 语义 token 与 `pkuso-web` 同名同结构，样式用语义类（`bg-page-bg` / `text-text` / `border-border`），禁止硬编码色值。

## 6. 多语言 / 国际化设计原则（i18n）

- **文案集中、禁止硬编码**：所有面向用户的可见字符串（标题、按钮、错误提示、空态、占位、tab 文案等）一律经 `t()` 取词；不要在组件/样式里写死中文字面量，否则英文模式会残留中文。
- **按页分文件**：`src/i18n/messages/<locale>/<page>.ts`（如 `common` / `profile` / `community`），由 `<locale>/index.ts` 聚合为 `export const <locale> = { common, profile, community }`。新增页面文案 = 加一个页文件并在聚合处引入。
- **基准语言 = `zh-CN`**：`en/index.ts` 必须 `export const en: typeof zhCN = {...}`，以 `zhCN` 的类型约束——**缺 key / 多 key 都会编译报错**，这是「漏翻必现」的硬保障。
- **取词方式**：`const { t } = useT()`；key 为点分路径如 `t('profile.settings.language')`，类型 `Path<ZHCNMessages>` 提供自动补全 + 编译期校验。
- **插值而非拼接**：动态内容用 `t('welcome', { name })`（`{name}` 占位），不要把变量拼进字符串后再翻译。
- **加载策略**：`zh-CN` 与 `en` **均静态打包**进主包（`src/i18n/index.tsx` 顶部有 `import { en }`；`zh-CN` 为默认避免首屏闪烁，`en` 为高频第二语言、动态 `import()` 会让英文用户冷启动短暂闪中文）。更低频的新语言再加 `import()` 动态分包；语言切换由 `LanguageProvider` 统一处理并全局重渲染。
- **缺词回退**：`t()` 在 key 缺失时回退到 key 本身（便于发现未翻）；生产环境不应出现裸 key。
- **语言选择**：默认**跟随系统**（`Taro.getAppBaseInfo().language`，以 `en` 开头视为英文），手动选择存 `Taro` storage 持久化；入口在「我的 → 设置栏 → 语言」。
- **Provider 挂载**：`LanguageProvider` 已在 `src/app.ts` 的 `ThemeProvider` 内层；正常页面已处于其内，直接用 `useT()`，无需额外包裹。
- **新增语言**：在 `Locale` 联合类型与 `loaders` 各加一项，并新建 `messages/<locale>/*` 按页补齐即可，**不引入新依赖**。
- **单测**：纯逻辑用已导出的 `translate(dict, key, params)`；组件依赖 `useT` 时 `vi.mock('@/i18n', () => ({ useT: () => ({ t: (k) => k, locale: 'zh-CN', setLocale: vi.fn() }) }))`。

## 7. 已知坑（改动相关文件时务必注意）

- **`space-y-*` / `divide-y-*` 在微信 WXSS 中无效**：其生成的 CSS 使用逻辑属性 `margin-block-start` / `:not([hidden])` 属性选择器，WXSS 不支持。间距请改用显式 `mb-*` / `mt-*` 等物理属性工具类。
- **tabBar 遮挡：所有 tab 页根容器必须「内联」预留真实 50px**。底边栏是 `position: fixed; bottom: 0; height: calc(50px + env(safe-area-inset-bottom))` 的浮层（`src/components/CustomTabBar.tsx`），页面根要用同样高度的**内联** `style` 预留：

  ```tsx
  <View style={{ paddingBottom: 'calc(50px + env(safe-area-inset-bottom))' }}>
  ```

  否则滚动内容末行会被永久遮挡、滚不到底。
  **关键坑：Taro 会把样式表（`.wxss`、Tailwind 工具类、`@utility`、`pb-[50px]` 等）里的 `px` 自动编译成 `rpx`**（`config/index.ts` 的 `designWidth: 750` + `pxtransform.enable`；`50px`→`50rpx`≈25px），而 tabBar 高度用的是**内联** `px`（不被转换）。所以写在 `app.css` / `className` 里的 `50px` 只留一半高度、照样遮挡——**只能在内联 `style` 里写真实 `px`**。
  关于 `pb-safe`：它是**有效**的纯安全区工具类（`src/app.css` 的 `@utility pb-safe`），但只覆盖安全区，**不足以替代 tabBar 的 50px 预留**，也不得用在 tab 页根容器上；`pb-8` / `pb-[50px]` 同理（后者还会被转 rpx）。
  **现役 tab 清单不要照抄本文档**——以 `src/app.config.ts` 的 `tabBar.list` 为准（`main` 与 `dev` 的 tab 集合可能不同），改动时逐个核对。
- **新建页面必须有 `index.scss` 并 `import`**：建 `src/pages/<page>/index.scss`（可放一条占位规则）并在页面 `tsx` 顶部 `import './index.scss'`。实测（`src/pages/index`）**空的 `index.scss` 也会生成 0 字节的 `index.wxss`**，所以后果不是"文件不存在"；真正的坑是 Taro 会跳过给包裹层注入 `.page { height: 100% }`，短内容页面因此高度塌陷、露出窗口背景色——由 `src/app.css` 的全局兜底接住。规则照旧：新页面别漏这个文件。
- **Modal 通过 `useLayoutEffect` 在绘制前隐藏 tabBar**（`src/components/ui/Modal.tsx`）。
- **`Input` / `Textarea` 必须用 `View` 包裹以约束宽度**：小程序原生 `Input`/`Textarea` 直接写 `w-full` 仍可能撑破父容器、超出画面。统一用「外层 `View`（承载边框/圆角/背景，带 `w-full overflow-hidden`）包住内层 `Input`/`Textarea`（内层用 `w-full bg-transparent`，高度如 `h-10`）」的写法（参考 `src/pages/login/index.tsx` 的邮箱/密码框）。改动表单页时务必沿用此模式。

## 8. 页面状态恢复设计原则

> ⚠️ **本节的前提尚未在真机验证，别在它上面继续盖新抽象。** 文档长期声称"页面重建后 `useState` 重置、`useRef` 状态保留"，但两者同属一个 React 组件实例——若页面真被销毁重建，ref 会一起重置（两个 hook 都会失效）；若 ref 能存活，则 `useState` 也应存活（`useEditDraft` 就成了多余的）。更可能的真相是**页面并未销毁**，只是 `Taro.getCurrentInstance().router.params` 在返回前台后被重置。**新增相关 hook 前先在真机确认机制**，或至少不要把未验证的推论写进注释。

### 问题背景

微信小程序调用以下 API 时会销毁/重建页面（或至少丢失路由参数）：

- `chooseMedia`：选择图片/视频
- `chooseAvatar`：选择微信头像
- `getLocation`：获取地理位置

### 解决方案

| Hook | 用途 | 文件位置 |
| --- | --- | --- |
| `usePageRestore<T>(paramName)` | 缓存 `router.params` 中的关键参数 | `src/hooks/usePageRestore.ts` |
| `useEditDraft<T>(defaultData)` | 缓存编辑态表单数据 | `src/hooks/useEditDraft.ts` |

`usePageRestore` 的两个已知瑕疵（**别照抄它的 JSDoc 示例**）：

- JSDoc 称"参数丢失时调用 `onRestore` 回调"，但函数签名并没有这个参数。
- 示例写 `usePageRestore<number>('id')`，而 `router.params` 实际是字符串（返回原样 cast）。正确用法见 `src/pages/rehearsal-detail/index.tsx`：`usePageRestore<string>` 之后再 `Number()`。
- 同文件的 `usePageRestoreMany` **是死代码**（零调用点），不要新增使用。

### 使用指南

#### 场景 1：页面依赖 router.params（如 id）

```tsx
import { usePageRestore } from '@/hooks/usePageRestore'

const cachedId = usePageRestore<string>('id')
const id = Number(cachedId)

useEffect(() => {
  if (!id) return
  fetchData(id)
}, [id])
```

#### 场景 2：编辑态表单数据（如创建/编辑页面）

标准范例是 `src/pages/post-create/index.tsx`（`useEditDraft` + `useDidShow` 回填 + 保存成功后 `clear()`）。

### 已应用页面：**不要照抄清单，按规则自查**

规则：穷举会销毁页面的 API 的**全部调用点**，逐页核对。

```bash
grep -rn "chooseMedia\|chooseAvatar\|getLocation" src --include=*.tsx --include=*.ts
```

截至 2026-09-28（`main`）的核对结果：

| 页面 | API | 现状 |
| --- | --- | --- |
| `rehearsal-detail` | getLocation | ✅ `usePageRestore<string>('id')` |
| `post-edit` | chooseMedia | ✅ `usePageRestore<string>('id')`，但**不恢复未保存内容**（重新 `fetchOne` 会用服务端旧值覆盖用户已敲的标题/正文） |
| `post-create` | chooseMedia | ✅ `useEditDraft` + `useDidShow`（标准范例）；`router.params.type` 未单独缓存，目前靠草稿掩盖 |
| `profile-info` | chooseAvatar | ✅ `useEditDraft` + `useDidShow` |
| `leave-request` | chooseMedia | ⚠️ **只缓存了路由参数**（手写 `initialParamsRef`，没复用 `usePageRestore`），`reason` / 附件仍是裸 `useState`——**选图会导致用户填的内容全丢**（已知缺口，未修） |

其余仍在裸读 `router.params` 的页面（`error` / `login` / `post-detail` / `register`）当前都不调用那三个 API，属潜在雷；`dev` 上另有谱务相关页面（`score-*`，`main` 还没有）。**核验请按上面的命令跑一遍，以你所在分支的实际情况为准。**

### 测试 Mock

```tsx
vi.mock('@tarojs/taro', () => ({
  default: taroMock,
  useDidShow: (fn: () => void) => {
    React.useEffect(() => {
      fn()
    }, [])
  },
}))
```

# 用户交互

与用户的交互全部使用简体中文。
