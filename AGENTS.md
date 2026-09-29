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

| 分支     | 是什么                    | push 之后                                                                                                                   |
| -------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `dev`    | 日常开发与测试基线        | 触发 `Deploy to WeChat Dev`：verify → 构建 → **上传到微信「开发版本」列表（robot 1 槽位）**                                 |
| `main`   | 稳定发布基线              | 触发 `Deploy to WeChat Prod`：verify → 构建 → **上传到微信「开发版本」列表（robot 2 槽位）** → 版本号提交回 `main` + 推 tag |
| 功能分支 | 从 `dev`（或 `main`）拉出 | **不触发任何 CI**                                                                                                           |
| `master` | 历史遗留，别用            | ——                                                                                                                          |

⚠️ 三条必须知道的事实：

1. **CI 只监听 `push` 到 `dev` / `main`，`pull_request` 不触发任何 workflow。** 开 PR 不会跑检查；想过闸门只能先推上去，失败后再补修复提交。所以本地闸门（§1.2）尽量一次跑干净。
2. **CI 有 `paths:` 白名单**（清单见 §3.2）。改 `AGENTS.md` / `README.md` / `docs/**` / `.env*` **不触发 CI**；改 `package.json` / `src/**` / `scripts/**` **会触发一次真实构建与上传**——所以「顺手改一下 `version`」不是无副作用操作。
3. **`main` 的现状并不等于「只接受从 dev 合并」**：历史里既有从 `dev` 合入，也有直接推 `main`、以及功能分支直接 merge 到 `main`。规范意图是 dev 先行，但别拿这句话去推断历史或断言别人做错了。

⚠️ **`dev` 与 `main` 是两条并行维护的线**（`dev` 还压着未发布的谱务），改动该走哪条、怎么发版见 **§1.5**。

### 1.2 交付闸门（Delivery Gate）

声明「完成 / 交付」前必须执行且全绿：

```bash
pnpm gate
```

**闸门的唯一定义在 `scripts/gate.mjs`** —— CI 与人都调它，本节不再复述命令清单（复述就会漂移：这里以前按 `build → typecheck → lint → test` 列，CI 实际是 `lint → typecheck → test → build`）。

它做三件事，第 3 件是重点：

1. 依次跑 `lint` → `typecheck` → `test` → `build:weapp`（最后一步与 CI 相同 = 生产环境构建）
2. 因为第 1 步留下的是一个**连生产库的 `dist/`**（原因见 §1.3），脚本**会自动再跑一次 `dev:weapp`**，产出一份可供验收的开发库包
3. 用 `dist/` 里是否含开发库地址**核对**这份包确实连的是开发库，然后打印验收指引

> 也就是说：**「跑完闸门」＝「手上已经有一份可以给人验收的包」**，不用再记得补一次构建。
> 只想快速跑检查、不要构建：`pnpm gate --skip-build`；CI 用 `pnpm gate:ci`（不产出 dev 包）。

两处仍然容易记混的地方：

- **CI 不跑 `pnpm format`。** `pnpm verify`（= `format && lint && typecheck && test`）只是本地便利命令；格式化请自己跑 `pnpm format:fix`。
- `pnpm dev:weapp` 与 `pnpm build:weapp` **都不是 watch 模式**，两者都是一次性构建，区别只在注入的环境变量（见 §1.3）。

交付后请提醒用户在开发者工具中点一次「设置 → 通用 → 清空缓存 / 重开项目」（脚本也会打印这句）。

### 1.3 ⚠️ 本地构建默认连的是**生产库**

| 命令                                    | `NODE_ENV`    | 读取的 env 文件    | 指向的 Supabase |
| --------------------------------------- | ------------- | ------------------ | --------------- |
| `pnpm build:weapp`                      | `production`  | `.env.production`  | **生产项目**    |
| `pnpm dev:weapp`                        | `development` | `.env.development` | 开发项目        |
| `NODE_ENV=development pnpm build:weapp` | `development` | `.env.development` | 开发项目        |

- env 文件由 Taro 按 `NODE_ENV` 选择；`NODE_ENV=development` 时 `config/index.ts` 额外 merge `config/dev.ts`。
- `.env.development` / `.env.production` **都不入库**（`.gitignore`），CI 从 secrets 写出这两份文件。本地要构建得先有（`cp .env.example .env.development` 后填值）。

**所以在开发者工具里点登录、翻数据之前，先确认 `dist/` 是哪个环境构建的。** 刚跑完闸门的 `build:weapp` 留下的是一个**连生产库**的 `dist/`；要调试先补一次 `pnpm dev:weapp`。

核对方法：

```bash
grep -rl "$(grep -m1 TARO_APP_SUPABASE_URL .env.development | cut -d= -f2)" dist   # 有命中 = 当前是开发库
```

**还有第二条路：境内反代**（可选，见 `cloudfunctions/README.md`）。`TARO_APP_SUPABASE_PROXY_URL` 有值时，`rest` / `auth` / `functions` 三条腿走它、网络层失败会自动换回直连重试，而 `storage` 与一切由它派生的文件 URL 恒走直连。**留空 = 与从前完全一致**（单入口，新逻辑全部短路）；想确认某个包走的是哪条路，`grep -rl <反代域名> dist/` 即可。

> ⚠️ 它是**构建期**烧进包里的（和 URL 一样），而 request 合法域名是静态的 ⇒ **启用与回滚都要走审核**。所以「启用它」必须与「自动回退」同批发布，别单独切。

### 1.4 提交规范

- **Conventional Commits**，由 husky + commitlint 强制（`.husky/commit-msg`）：`<type>: <描述>`。
- 常用 type：`feat` `fix` `docs` `style` `refactor` `test` `chore` `ci`。
- 描述用中文（沿用本仓库历史）。
- 没有配置 `lint-staged`，提交前不会自动跑 lint / format——闸门得自己跑。

### 1.5 ⚠️ 两条线：稳定线 `main` 与开发线 `dev`

仓库同时跑两条线，**分支决定归属**：

| 线     | 分支   | 内容                                            | 合并后触发                                                                                               |
| ------ | ------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 稳定线 | `main` | 修复、体验、工具链、与 web 对齐——**随时可发**   | `Deploy to WeChat Prod`：生产库构建 → 上传开发版本列表 robot 2 → `version:release` → 回写版本号 + 推 tag |
| 开发线 | `dev`  | **正在做、尚不稳定/未发布的（一个或多个）功能** | `Deploy to WeChat Dev`：开发库构建 → 上传 robot 1                                                        |

⚠️ `dev` **不等于「谱务分支」**——它是「未发布功能的集成分支」，谱务只是**当前**占用它的那件事（上一个占用者是客户端错误收集）。占用者会换，下面这些规矩不变，所以别把规矩写成「谱务专属」。

**版本号不标记线**：`dev` 上未发布的功能合进 `main` 之后，`main` 的版本号会跟着上去（`0.4.x` → `0.5.x`），两条线同档是正常状态。所以**别拿版本号判断一条改动属于哪条线——看分支**。

#### 动手前先定 base（默认分支是 `main`，但**多数改动要从 `dev` 拉**）

仓库的默认分支是 `main`。这意味着 `git clone`、`git checkout -b <名字>`（不带起点）、以及网页上开 PR 的默认 base **全是 `main`** —— 而下面这些情况里，`main` 恰恰是错的起点。**别用默认值，先判断：**

```bash
# 这次要改的每个路径，在 main 上存在吗？
git cat-file -e origin/main:<路径>     # 报错 = main 上没有 = 属于「尚未发布的功能」
```

| 判断结果                | base       | 之后合到哪                                            |
| ----------------------- | ---------- | ----------------------------------------------------- |
| 有路径在 `main` 上不存在 | **`dev`**  | `dev`（这就是开发线改动）                             |
| 全部路径 `main` 上都有   | **`main`** | 先合 `dev` 拿真机验收，再 cherry-pick 到 `main` 发版  |
| 拿不准                  | **`dev`**  | 按开发线处理——代价小；反过来的代价是把未发布功能带上正式线 |

**日常不一定需要开分支**：本仓库实际是「`dev` 当主干」的开发方式（实测 dev 上 92% 的提交是直接提交）。小改动直接提交到 `dev` 就行；**开分支的价值在于**「风险大 / 周期长 / 想留一条可回顾的线」。开了分支就按上表选 base。

Claude Code 用户：这条规则有配套的 skill（`.claude/skills/base-branch`），它会在你打算 `git checkout -b` 时把上面的判断走一遍。

**规矩**：

1. **稳定化改动先合 `dev`**（拿开发版真机验收）→ 验完再 **cherry-pick 到 `main`** 发版。
   不直接 `dev → main` 的原因：`dev` 上压着尚未发布的功能，直接合会把它们一起带上正式线。
2. **稳定化改动不得触碰「尚未发布功能」的文件**。碰了就无法干净 cherry-pick——实测过一次：一个「测试布局统一」的顺手改动搬了 `src/lib/annotation.test.ts`，而 `annotation.ts` 属于当时未发布的谱务，导致该提交挑到 `main` 时冲突。（这条引的路径以前写成 `src/lib/__tests__/annotation.test.ts` —— 那个目录不存在；注意 `annotation.test.ts` 自己也在这份「别碰」的名单里。）
3. **稳定化改动保持单提交**（squash merge 天然满足），cherry-pick 才是一条命令的事。
4. **发版前把 `main` 的 `package.json` 版本 bump 一档**：CI 的 `version:release` 只去预发布后缀、**不自动 +1**，而 `v<version>` 的 tag 已存在时会跳过推 tag——不 bump 就会用同一个版本号再传一次。
5. 两条线并行维护，同一批改动可能在两边各有一份提交（例如 error-report）。挑过去时用 `git cherry-pick -x` 记录来源，便于日后对账。

**哪些文件属于「尚未发布的功能」**——**跑命令，别背清单**：

```bash
node scripts/unpublished.mjs        # 默认比 origin/main ← origin/dev
```

它输出两段，**两段都不能碰**：

1. **只在 `dev` 上存在的路径** —— 经典的那一类（谱务的页面、hooks、i18n 文案、图标…）。
2. **两条线上都有、但内容不同的路径** —— ⚠️ **这一类旧判据完全看不见**，而它同样会毁掉 cherry-pick：
   它们过得了「`main` 上存在吗」，但已经在 `dev` 上带着谱务接线了（`src/app.config.ts` 多了谱务 tab、
   `src/lib/tabBarConfig.ts` 多了它的路径、`src/components/CustomTabBar.tsx` 多了三个图标 import、
   `src/i18n/messages/<locale>/index.ts` 多了四个聚合项）。整份拷过去 = **静默把谱务带上正式线**。

⚠️ **不要再用以前那条 `git cat-file -e origin/main:<路径>`**：它要**逐个**传路径，而以 `.` 开头的首段会被
Git Bash（MSYS）改写成 `origin\main;<路径>`，于是 `.gitignore`、`.github/**` 这类文件**一律报「对象名无效」**——
按当时的判读规则（「报错 = main 上没有」）就会被**误判成未发布功能**。真要单独查一个路径，
用 `git ls-tree -r origin/main --name-only | grep -x <路径>`，或在 Git Bash 里先 `export MSYS_NO_PATHCONV=1`。

> 这份清单以前是**手写**的，已经错过一次：实测漏 13 条，其中包括 `src/pages/score/index.tsx`
> —— **谱务 tab 页本身**（`src/pages/score-*` 匹配不到 `score/` 这个没有连字符的目录名）。
> 清单会腐烂，命令不会。

> 将来若把某个未发布功能挪到自己的分支：**必须同时改 CI**（`.github/workflows/deploy-dev.yml` 的 `branches:`），否则那条分支拿不到开发版构建。

---

## 2. 版本号管理

**单一事实来源 = `package.json` 的 `version`。** 构建时由 `config/index.ts` 注入为全局常量 `APP_VERSION`，显示在「我的」页脚与「问题与反馈」弹窗。它与微信后台的上传版本号是两回事。

### 2.1 本地脚本（`scripts/version.js`，只改 `package.json`，不碰 git）

```bash
node scripts/version.js          # 只打印当前版本
```

| 命令                   | 效果                      | 场景         |
| ---------------------- | ------------------------- | ------------ |
| `pnpm version:dev`     | `0.4.26` → `0.4.26-dev.1` | 开发期标记   |
| `pnpm version:rc`      | → `0.4.26-rc.1`           | 准备提审     |
| `pnpm version:release` | `0.4.26-rc.1` → `0.4.26`  | 去预发布后缀 |
| `pnpm version:bump`    | `0.4.26` → `0.4.27`       | patch 升级   |
| `pnpm version:minor`   | → `0.5.0`                 | 次版本       |
| `pnpm version:major`   | → `1.0.0`                 | 主版本       |

### 2.2 ⚠️ 大多数情况下你**不该**手动改版本号

因为 **CI 会在部署时重写它**：

- `dev`：`DEV_VERSION_NUM=${{ github.run_number }} pnpm version:dev` → 版本变成 `<package.json 里的基础版本>-dev.<run_number>`（如 `0.4.26-dev.37`）。**不提交回去**，每次推送重算。
- `main`：`pnpm version:release` → 去掉预发布后缀，然后以 `chore: release <version> [skip ci]` **提交回 `main`**，并推 tag `v<version>`。

推论：

- 在功能分支里改 `version`，**被 CI 重写的只有预发布后缀**：三段基础版本（`0.4.26`）会被沿用。所以为了标记「开发阶段」而跑 `pnpm version:dev` / `version:rc` 是白做的（本地看得见，CI 里会被替换成 `-dev.<run_number>` 或直接去掉）；但升基础版本（`pnpm version:bump` / `minor` / `major`）会真实生效。
- 想发新版：正常改代码 → 合 `dev` → 验证 → 合 `main`。版本号与上传都交给 CI，不要手工模拟。

### 2.3 ⚠️ `pnpm branch:create` 的两个坑

```bash
pnpm branch:create <patch|minor|major> <描述>
# 例：pnpm branch:create patch 修复登录bug
```

它依次做四件事：按 `<type>/<描述>` 建分支 → 改 `package.json` 版本 → 提交 `chore: bump version to X` → 建**本地** tag `vX`（不推送）。

1. ~~版本号带预发布后缀时它算错~~ **已修**（2026-09-28 前后）：`scripts/create-branch.js` 现在把版本计算整个委托给 `scripts/version.js`（那份逻辑的唯一实现，CI 的 dev/prod 部署也用它），实测 `0.4.26-dev.1` → `0.4.27`。**这条以前写的是「别在 `pnpm version:dev` 之后跑 `branch:create`，否则会写出 `0.4.NaN`」** —— 那个 bug 真实存在过，但代码早已修好，照旧文档走等于绕着一个已经拆掉的雷区。
2. **它会自己提交一次 `package.json`**，这个提交会跟着你合进 `dev` / `main`，并因此命中 CI 的 `paths:` 白名单。

### 2.4 tag

- `branch:create` 建的是**本地** tag，不推送。
- CI 的 prod 部署建并推 `v<version>`，且**先查远程是否已有同名 tag**（同一版本重复部署是常见情形），有就跳过——所以 tag 与部署不是一一对应。
- 查看：`git log --oneline --decorate` / `git log --tags --oneline`。

---

## 3. CI/CD：Deploy to WeChat 到底做了什么

两个 workflow：`.github/workflows/deploy-dev.yml`（`dev`）、`deploy-prod.yml`（`main`）。环境：pnpm 11、Node 22、`pnpm install --frozen-lockfile`。

### 3.1 步骤对照

|                                  | `dev`                                                                      | `main`                                                                  |
| -------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| verify job（两个 workflow 相同） | `pnpm lint` → `pnpm typecheck` → `pnpm test` → 构建                        | 同左                                                                    |
| 构建前写 env                     | `.env.development`（secrets `DEV_SUPABASE_URL` / `DEV_SUPABASE_ANON_KEY`） | `.env.production`（`PROD_SUPABASE_URL` / `PROD_SUPABASE_ANON_KEY`）     |
| 版本号                           | `DEV_VERSION_NUM=<run_number> pnpm version:dev`                            | `pnpm version:release`                                                  |
| 构建命令                         | `NODE_ENV=development pnpm build:weapp`                                    | `pnpm build:weapp`                                                      |
| 上传                             | `node scripts/upload.js`，**robot 1**                                      | 同左，**robot 2**                                                       |
| 收尾                             | ——                                                                         | 版本号提交回 main（`[skip ci]`）+ 推 tag `v<version>`（远程已有则跳过） |

**两个 workflow 的 upload 步骤都只是「上传代码包」，都不发布版本。** 产物落进微信公众平台的**开发版本**列表；「提交审核」与「发布」没有开放 API，必须人工在平台上操作。所以：

- 合 `dev` → 开发版本列表多一份代码（robot 1 槽位），可设为体验版；
- 合 `main` → 开发版本列表多一份代码（robot 2 槽位）；
- **上线正式版仍需人工「提交审核 → 发布」**——不要以为合了 `main` 就上线了。

> robot 槽位是 `scripts/upload.js` 的机制：`ci.upload()` 没有「版本类型」参数，服务端也无法区分来源，微信把每个 robot 当作开发版列表里的独立上传位置，不同 robot 互不覆盖。不区分的话 dev 与 prod 的 CI 会互相顶掉。**别把两个 workflow 的 robot 改成同一个。**

### 3.2 触发条件

```yaml
on:
  push:
    branches: [dev] # deploy-prod.yml 是 [main]
    paths:
      - src/**
      - config/**
      - scripts/**
      - package.json
      - pnpm-lock.yaml
      - .npmrc
      - tsconfig.json
      - vitest.config.ts
      - app.css
      - app.scss
      - .github/**
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
  **现役 tab 清单不要照抄本文档**——它在**三处**各有一份，改一处必须同时改另两处（`main` 与 `dev` 的 tab 集合也可能不同）：

  | 位置 | 作用 |
  | --- | --- |
  | `src/app.config.ts` 的 `tabBar.list` | 框架用：决定哪些页面是 tab 页 |
  | `src/components/CustomTabBar.tsx` 的 `LIST` | 自绘底边栏：图标三色 + i18n key |
  | `src/lib/tabBarConfig.ts` 的 `TAB_PAGE_PATHS` | 把当前路由换算成选中索引 |

  三份**互指**（每份的注释都说「与另一份保持同步」），没有哪一份是权威。核对命令：

  ```bash
  grep -n "pagePath\|'/pages/" src/app.config.ts src/components/CustomTabBar.tsx src/lib/tabBarConfig.ts
  ```

  ⚠️ `CustomTabBar` 里还有**硬编码的下标**（`idx === 4` 判「我的」、`idx === 0` 判首页的未读红点）——
  增删 tab 时它们**不会报错，只会指错页**。（三份清单该合并成一份，尚未做。）

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

| Hook                           | 用途                              | 文件位置                      |
| ------------------------------ | --------------------------------- | ----------------------------- |
| `usePageRestore<T>(paramName)` | 缓存 `router.params` 中的关键参数 | `src/hooks/usePageRestore.ts` |
| `useEditDraft<T>(defaultData)` | 缓存编辑态表单数据                | `src/hooks/useEditDraft.ts`   |

`usePageRestore` 的注意事项：

- **`router.params` 的值是字符串**，而 hook 按 `T` 原样 cast。所以取数字要写
  `usePageRestore<string>('id')` 再 `Number()`（见 `src/pages/rehearsal-detail/index.tsx`），
  别写 `usePageRestore<number>` 自欺。
  （这一条以前被写成「JSDoc 的两个已知瑕疵：`onRestore` 回调 / `usePageRestore<number>` 示例」——
  JSDoc 里这两个问题**都已经不存在了**：签名从来没有 `onRestore`，示例现在就是 `<string>` + `Number()`。）
- 同文件的 `usePageRestoreMany` **不存在** —— 它曾在 `usePageRestore.ts` 里，2026-09-28 的 `b3ce592` 已连定义一起删除，全仓（含测试）零命中。**别 import 它**（编译不过）。这条以前写的是「是死代码（零调用点），不要新增使用」，读起来像「有个能用的 API 只是没人用」。

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

⚠️ **下表是一次核对的快照，不是权威**（2026-09-30 复核时发现其中三行已经过期 —— 详见「这一版修掉了什么」）。
权威只有你自己跑上面那条 `grep` 得到的调用点，逐页去读。

| 页面               | API          | 现状                                                                                                                                                            |
| ------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rehearsal-detail` | getLocation  | ✅ `usePageRestore<string>('id')`                                                                                                                               |
| `post-edit`        | chooseMedia  | ✅ `usePageRestore<string>('id')` + `useEditDraft`。**未保存内容会恢复**：`:108` 有 `if (editDraft.hasDraft()) return` 挡在「用服务端旧值回填表单」前面（此前这里写的是「不恢复未保存内容」，已过期） |
| `post-create`      | chooseMedia  | ✅ `useEditDraft` + `useDidShow`（标准范例）；`router.params.type` 未单独缓存，目前靠草稿掩盖                                                                   |
| `profile-info`     | chooseAvatar | ✅ `useEditDraft` + `useDidShow`                                                                                                                                |
| `leave-request`    | chooseMedia  | ✅ `usePageRestore`（三个参数）+ `useEditDraft` + `useDidShow`，`reason`/附件都是带草稿初值的 `useState`。**选图不会丢内容**（此前这里标的是「只缓存路由参数、选图内容全丢、未修」—— 那是 `b3ce592` 修掉之前的状况） |

其余仍在裸读 `router.params` 的页面（`error` / `login` / `post-detail` / `register`）当前都不调用那三个 API，属潜在雷；`dev` 上另有谱务相关页面（`score-*`，`main` 还没有）。**核验请按上面的命令跑一遍，以你所在分支的实际情况为准。**

> **这一版修掉了什么**（2026-09-30 逐条核验）：上一版这节里有三条会指挥人做错事 ——
> `usePageRestoreMany`（**函数根本不存在**，2026-09-28 已随 `b3ce592` 删除）、
> `leave-request` 的「选图丢数据」（**同一天就修好了**，而文档把修复日写成了核对日）、
> `post-edit` 的「不恢复未保存内容」（同样已修）。三条都是**「未修」在修复落地的同一天写下的**。

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
