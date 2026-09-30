#!/usr/bin/env node
/**
 * 「哪些文件属于**尚未发布的功能**」——**从 git 现算，不要背清单**。
 *
 *   node scripts/unpublished.mjs            # 默认比 origin/main ← origin/dev
 *   node scripts/unpublished.mjs <base> <topic>
 *
 * ## 为什么要写成命令
 *
 * `AGENTS.md` §1.5 的规矩 2 是「稳定化改动不得触碰尚未发布功能的文件，否则 cherry-pick 会冲突」。
 * 它的判据原来是一条**手写清单**，而手写清单已经错过一次 —— 实测漏了 13 条路径，
 * 其中包括 `src/pages/score/index.tsx`（**谱务 tab 页本身**，因为 `src/pages/score-*`
 * 匹配不到 `score/` 这个没有连字符的目录名）。
 *
 * 更糟的是它原来推荐的判据 `git cat-file -e origin/main:<路径>` **在 Windows/Git Bash 下会
 * 给出假阴性**：以 `.` 开头的首段会被 MSYS 改写（`origin/main:.gitignore` →
 * `origin\main;.gitignore`），报 `Not a valid object name` —— 而这条命令的判读规则正是
 * 「报错 = main 上没有」。于是 `.github/**`、`.gitignore` 这类文件会被**误判成未发布功能**。
 * （绕开办法：`MSYS_NO_PATHCONV=1`，或改用本脚本用的 `git ls-tree` —— 它一次列全，
 * 不把路径当参数传。）
 *
 * ## 它输出两类，**第二类是旧判据完全看不见的**
 *
 * 1. **只在 topic 线上有的路径** —— 经典的「未发布功能」。这是手写清单想覆盖的那一类。
 * 2. **两条线上都有、但内容不同的路径** —— 它们过得了「main 上存在吗」这个判据，
 *    按 §1.5 的决策表会被判成「稳定线改动，base 取 main」，但它们**已经在 topic 线上
 *    带着未发布功能的接线**了（实测：`src/app.config.ts` 多了谱务 tab、
 *    `src/lib/tabBarConfig.ts` 多了它的路径、`src/components/CustomTabBar.tsx` 多了三个图标 import、
 *    `src/i18n/messages/<locale>/index.ts` 多了四个聚合项）。稳定化改动只要碰这四个文件，
 *    要么 cherry-pick 冲突，要么整份拷过去时**静默带上谱务接线**。
 *
 * 这也是为什么这个脚本**不退出非零**：它不是门，是一张地图。判读在人（或 agent）手里。
 */

import { execFileSync } from "node:child_process";

const [, , baseArg, topicArg] = process.argv;
const base = baseArg ?? "origin/main";
const topic = topicArg ?? "origin/dev";

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    console.error(`✗ git ${args.join(" ")} 失败：${(e.stderr ?? "").trim() || e.message}`);
    process.exit(2);
  }
}

function refExists(ref) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// 与 check-types.mjs 同一条道理：**解析不到 base 必须报错退出**，不能打印一张空表 ——
// 空表会被读成「没有未发布文件，随便改」。fetch 一下就能修。
for (const ref of [base, topic]) {
  if (!refExists(ref)) {
    console.error(
      `✗ 解析不到 ${ref}。先 \`git fetch origin\`（浅克隆请先 \`git fetch --unshallow\`）。`,
    );
    process.exit(2);
  }
}

const list = (ref) =>
  git(["ls-tree", "-r", "--name-only", ref])
    .split("\n")
    .filter(Boolean);

const baseFiles = new Set(list(base));
const topicFiles = list(topic);
const changed = new Set(
  git(["diff", "--name-only", base, topic])
    .split("\n")
    .filter(Boolean),
);

const onlyInTopic = topicFiles.filter((p) => !baseFiles.has(p)).sort();
const bothDiverged = topicFiles.filter((p) => baseFiles.has(p) && changed.has(p)).sort();

/** 按顶层目录归并，长清单也看得清 */
function group(paths) {
  const byDir = new Map();
  for (const p of paths) {
    const dir = p.includes("/") ? p.slice(0, p.indexOf("/")) : "(仓库根)";
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(p);
  }
  return byDir;
}

function printSection(title, note, paths) {
  console.log(`\n## ${title}（${paths.length} 个）`);
  console.log(note);
  for (const [dir, ps] of [...group(paths)].sort()) {
    console.log(`\n  ${dir}/  (${ps.length})`);
    for (const p of ps) console.log(`    ${p}`);
  }
}

console.log(`比较 ${base} ← ${topic}`);

printSection(
  "只在 topic 线上存在",
  "  ⇒ 这些就是「尚未发布的功能」。稳定化改动**不得触碰**，否则 cherry-pick 到 base 必冲突。",
  onlyInTopic,
);

printSection(
  "两条线上都有、但内容不同",
  "  ⇒ ⚠️ **旧判据看不见这一类**。它们过得了「base 上存在吗」，但已经在 topic 线上带着\n     未发布功能的接线；碰了照样冲突，或整份拷过去时静默带上未发布功能。",
  bothDiverged,
);

console.log(
  "\n判读：稳定化改动的 base 取哪条线，看**它要改的每个路径落在哪一段**——\n" +
    "  落在第一段 ⇒ base 取 topic 线；两段都不落 ⇒ base 取 base 线（先合 topic 线拿真机验收，\n" +
    "  再 cherry-pick 到 base 线）。第二段要特别小心：它们看起来「两边都有」，但内容不一样。",
);
