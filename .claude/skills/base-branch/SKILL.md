---
name: base-branch
description: 在 pkuso-mp 里新建分支（git checkout -b / git switch -c）之前使用。本仓库有 main 与 dev 两条线而默认分支是 main，用默认值选起点会把未发布功能带上正式线。本 skill 走一遍机械判据，定出 base 与目标分支。
---

# 选对 base 分支（pkuso-mp）

本仓库同时跑两条线（完整规则见 `AGENTS.md` §1.5）。**默认分支是 `main`**，所以
`git clone`、不带起点的 `git checkout -b <名字>`、以及网页开 PR 的默认 base 全都是 `main`
—— 而在多数改动里 `main` 是错的起点。这个 skill 就是把那次判断走一遍。

## 什么时候用它

- **准备跑 `git checkout -b` / `git switch -c` 时**（包括 `pnpm branch:create`，它内部会建分支）
- 准备开 PR 而没想清楚 base 时
- 用户说「改一下 XX」而你没确认它属于哪条线时

## 先问一句：真的需要开分支吗

本仓库实际是「`dev` 当主干」的开发方式（实测 dev 上 92% 的提交是直接提交）。
**小改动直接提交到 `dev` 就是允许的**，别为了「规范」凭空开分支。

开分支的价值只在：风险大 / 周期长 / 想留一条可回顾的线。

## 需要开分支时，按这个顺序定 base

**第 1 步 · 列出这次要改的路径**（还没想清楚就先别建分支）。

**第 2 步 · 逐个跑机械判据**（不要凭感觉）：

```bash
git fetch origin
git cat-file -e origin/main:<路径>    # 报错 = main 上没有 = 属于「尚未发布的功能」
```

**第 3 步 · 按结果定 base**：

| 结果 | 线 | base | 之后合到哪 |
| --- | --- | --- | --- |
| **有路径在 `main` 上不存在** | 开发线 | `origin/dev` | `dev` |
| **全部路径 `main` 上都有** | 稳定线 | `origin/main` | 先合 `dev` 拿真机验收，再 cherry-pick 到 `main` 发版 |
| 拿不准 | 开发线 | `origin/dev` | `dev` |

**拿不准一律取 `dev`**：按开发线处理的代价只是「晚一点上正式线」；反过来把未发布功能带上
正式线是**不可逆**的（已经提交审核/发布了）。

```bash
# 开发线
git checkout -b <type>/<简述> origin/dev
# 稳定线
git checkout -b <type>/<简述> origin/main
```

**第 4 步 · 在回复里声明你的判断**：说明「这是稳定线/开发线改动、base 是 X、依据是 Y」。
用户要纠正的话，看到这句话就能纠正；不说的话，等发现时通常已经合错了。

## 三种最常见的错（都真实发生过）

1. **用了默认 base**。`git checkout -b fix/xxx` 不带起点 → 起点是 `main`。
   如果这次改动其实要碰未发布功能的文件，合进 `main` 就会把未发布功能带上正式线。
2. **"顺手" 碰了未发布功能的文件**。稳定线改动只要碰了一个 `main` 上没有的文件，就无法
   干净 cherry-pick。实测发生过一次：一个「测试布局统一」的顺手改动搬了属于未发布功能的
   测试文件，导致该提交挑到 `main` 时冲突。
3. **开了 PR 但 base 选错**。网页开 PR 默认 base 是 `main`，而开发线改动应当开向 `dev`。

## 建完分支之后

- 稳定线改动**保持单提交**（squash merge 天然满足），cherry-pick 才是一条命令的事
- 交付闸门是 `pnpm gate`（见 `AGENTS.md` §1.2）——它会跑完检查并**顺手产出一份连开发库的
  `dist/`** 供真机验收
- 推送后 CI 会自动上传开发版（见 §3），**PR 阶段不跑任何检查**
