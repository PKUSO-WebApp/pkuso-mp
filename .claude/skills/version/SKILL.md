---
name: version
description: 在 pkuso-mp 里动 package.json 的 version（bump / dev / rc / release）之前使用。版本号是单一事实来源，而 CI 会在部署时重写它的一部分 —— 这个 skill 给出真实可用的命令、什么时候不该动它、以及发版前必须动它的判据。
---

# 版本号怎么动（pkuso-mp）

**单一事实来源 = `package.json` 的 `version`**（构建时注入 `APP_VERSION`，显示在「我的」页脚）。
完整规则在 `AGENTS.md` §2；这里只放**实际命令**与**已经踩过的坑**。

## 命令（唯一定义在 `scripts/version.js`）

| 命令 | 效果 |
| --- | --- |
| `node scripts/version.js` | **只打印**当前版本 + 用法（不带参数什么都不会改） |
| `... dev` ｜ `pnpm version:dev` | `0.5.4` → `0.5.4-dev.1`（已有 dev 后缀则递增） |
| `... rc` ｜ `pnpm version:rc` | → `0.5.4-rc.1` |
| `... release` ｜ `pnpm version:release` | 去掉预发布后缀 |
| `... bump` **或** `... patch` ｜ `pnpm version:bump` | 补丁升级 `0.5.4` → `0.5.5` |
| `... minor` ｜ `pnpm version:minor` | → `0.6.0` |
| `... major` ｜ `pnpm version:major` | → `1.0.0` |

⚠️ 脚本里是 `case 'bump': case 'patch':` —— **两个词都接受**；而用法文本只列了 `patch`、
文件头注释只写 `bump`。**两个都对**，别以为哪个写错了。

⚠️ **命令带 `>/dev/null` 跑时看不见输出** ——「没输出」既可能是成功也可能是「参数不认识、
只打印了用法」。改完**一定**跑一次不带参数的 `node scripts/version.js` 确认新值。

## 什么时候**不该**动它

CI 会在部署时重写版本号（`AGENTS.md` §2.2）：

- **dev**：`<基础版本>-dev.<run_number>`（如 `0.5.4-dev.255`），**不提交回去**，每次推送重算；
- **main**：`pnpm version:release` 去掉后缀 → 提交回 main（`[skip ci]`）→ 推 tag `v<版本>`
  （**远程已有同名 tag 时跳过**）。

⇒ 在功能分支/开发期跑 `version:dev` / `version:rc` 是**白做**（CI 会替换掉后缀）；
**只有升三段基础版本（bump / minor / major）才真实生效**。

## 什么时候**必须**动它

**发版前，把基础版本升过「已存在的最大 tag」。**
`version:release` 只脱后缀、**不 +1**，且同名 tag 已存在时会跳过推 tag
⇒ 不升就会**用同一个版本号再传一次**（且这一版的 tag 不存在，事后无法对账）。

判据（两条一起看）：

```bash
git tag --sort=-creatordate | head -3        # 已经发布到哪一版
git show origin/dev:package.json | grep version
git show origin/main:package.json | grep version
```

两边的基础版本**低于**最新 tag 就必须先升。实测（2026-10-16）：dev 基线 `0.5.2`、main `0.5.3`、
tag 已到 `v0.5.3` ⇒ 合 main 之前先 `pnpm version:bump` 到 `0.5.4`。

## 改完怎么核

```bash
git diff package.json     # 应当只有 version 一行变化
node scripts/version.js   # 打印出来的就是新值
```

`package.json` 在 CI 的 `paths:` 白名单里 ⇒ **推上去会触发一次真实构建与上传**
（dev → robot 1，main → robot 2），别把它当无副作用的操作。
