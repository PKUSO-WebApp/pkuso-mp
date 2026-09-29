#!/usr/bin/env node
/**
 * 逐个验证 Dependabot 的 PR 是否真的能过闸门。
 *
 * 用法：
 *   pnpm check-dependabot              检查所有开着的 Dependabot PR
 *   pnpm check-dependabot --pr 35      只检查某一个
 *   pnpm check-dependabot --keep       保留 worktree（排查失败时用）
 *
 * ## 为什么需要它
 *
 * **本仓库的 CI 不监听 `pull_request`**（只监听 push 到 dev/main），所以 Dependabot 开出来的
 * PR **一个检查都不会跑**。破坏性升级因此只能等合进 dev/main、触发构建之后才暴露 ——
 * 实测 2026-09-29：`webpack` 5.91 → 5.111 把 Taro 的构建打挂，而它一路合进了 main，
 * 直到 `Deploy to WeChat Prod` 报 FAILURE 才被发现。
 *
 * 这个脚本就是那条缺失的闸门：**在合并之前**，拿每个 PR 的分支真跑一遍
 * `scripts/gate.mjs --ci`（lint → typecheck → test → 生产构建）。
 *
 * ## 为什么用 worktree
 *
 * 切分支会在工作区里留下副作用（未提交改动、`dist/`、切错分支忘了切回来）。
 * worktree 让每个 PR 在独立目录里被检查，**你的工作区全程不动**。
 *
 * ## 三个必须处理的细节（都踩过）
 *
 * 1. **调用一律用「命令 + 参数数组」，不经 shell**。`shell: true` 在 Windows 上会把整条
 *    命令交给 cmd.exe，于是 jq 表达式里的 `|` 被当成管道符（实测报
 *    `'select' 不是内部或外部命令`）。
 * 2. **`.env.*` 是 gitignore 的**，新 worktree 里没有。不补的话构建会因为缺环境变量
 *    而失败 —— 那是**假失败**，与被升级的包毫无关系。所以这里把它们从主工作区拷过去。
 * 3. **`node_modules` 要真装**。复用主工作区的 node_modules 就测不出依赖冲突了。
 *    pnpm 会复用 store，所以每个 PR 的安装通常只要十几秒。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, copyFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const KEEP = args.includes('--keep')
const ONLY = args.includes('--pr') ? args[args.indexOf('--pr') + 1] : null

/** 全程不经 shell —— 见文件头「三个必须处理的细节」第 1 条 */
const spawn = (cmd, cmdArgs, opts = {}) =>
  spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', ...opts })

const quiet = (cmd, cmdArgs, opts = {}) => spawn(cmd, cmdArgs, { stdio: 'pipe', ...opts })

/**
 * pnpm 在 Windows 上是 `.cmd` shim，**不经 shell 起不来**（Node 对 .cmd/.bat 做了限制）——
 * 实测 `spawnSync('pnpm', [...])` 直接失败且 stdout/stderr 全空，报错藏在 `error` 字段里。
 * 所以只有 pnpm 这一处放开 shell；参数里没有管道/重定向之类会被 cmd.exe 解释的东西。
 */
const pnpm = (cmdLine, cwd) =>
  spawnSync(cmdLine, { cwd, shell: true, encoding: 'utf8', stdio: 'pipe' })

/** 从输出里挑一句最能说明问题的（构建报错通常多行） */
function pickReason(output, err) {
  if (err) return String(err.message || err).slice(0, 180)
  const lines = String(output || '')
    .split('\n')
    .map((l) => l.replace(/\u001b\[[0-9;]*m/g, '').trim())
    .filter(Boolean)
  const hit = lines.filter((l) => /error|failed|✗|Cannot find|Invalid options/i.test(l))
  return (hit.slice(0, 2).join(' / ') || lines[lines.length - 1] || '（无输出）').slice(0, 180)
}

// ---- 列出要检查的 PR ----
const listed = quiet('gh', [
  'pr',
  'list',
  '--json',
  'number,title,headRefName',
  '--jq',
  '[.[] | select(.headRefName | startswith("dependabot/"))]',
])
if (listed.status !== 0) {
  console.error('列 PR 失败（gh 是否已登录？）：', listed.stderr)
  process.exit(1)
}
let prs = JSON.parse(listed.stdout || '[]')
if (ONLY) prs = prs.filter((p) => String(p.number) === String(ONLY))
if (prs.length === 0) {
  console.log('没有要检查的 Dependabot PR。')
  process.exit(0)
}

// ---- 主工作区里的 env 文件（被 gitignore，但构建需要）----
const envFiles = ['.env.development', '.env.production', '.env.test'].filter((f) =>
  existsSync(join(ROOT, f)),
)
if (envFiles.length === 0) {
  console.log('⚠️  主工作区没有 .env.development / .env.production —— 构建很可能假失败。')
  console.log('   先按 AGENTS.md §1.3 准备：cp .env.example .env.development 并填值。\n')
}

console.log(`要检查 ${prs.length} 个 PR；worktree 里会补上：${envFiles.join(' ') || '(无)'}\n`)

const results = []
const created = []

for (const pr of prs) {
  const branch = pr.headRefName
  let dir
  process.stdout.write(`▶ #${pr.number} ${pr.title.slice(0, 58)}\n`)

  try {
    const fetched = quiet('git', ['fetch', 'origin', branch, '--quiet'])
    if (fetched.status !== 0) {
      throw new Error(`fetch 失败：${pickReason(fetched.stderr, fetched.error)}`)
    }

    dir = mkdtempSync(join(tmpdir(), `dep-check-${pr.number}-`))
    rmSync(dir, { recursive: true, force: true }) // worktree add 要求目标不存在

    const wt = quiet('git', ['worktree', 'add', '--detach', dir, `origin/${branch}`])
    if (wt.status !== 0) {
      throw new Error(`worktree 建失败：${pickReason(wt.stderr, wt.error)}`)
    }
    created.push(dir)

    for (const f of envFiles) copyFileSync(join(ROOT, f), join(dir, f))

    const inst = pnpm('pnpm install --frozen-lockfile', dir)
    if (inst.status !== 0) {
      throw new Error(`pnpm install 失败：${pickReason(inst.stdout + inst.stderr, inst.error)}`)
    }

    const gate = quiet('node', ['scripts/gate.mjs', '--ci'], { cwd: dir })
    if (gate.status !== 0) {
      throw new Error(`闸门失败：${pickReason(gate.stdout + gate.stderr)}`)
    }

    results.push({ pr, ok: true })
    console.log('  ✅ 过闸门')
  } catch (e) {
    results.push({ pr, ok: false, reason: e.message })
    console.log(`  ❌ ${e.message}`)
  } finally {
    if (dir && !KEEP) {
      quiet('git', ['worktree', 'remove', '--force', dir])
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

// ---- 汇总 ----
console.log('\n================ 汇总 ================')
for (const r of results) {
  console.log(
    `${r.ok ? '✅' : '❌'}  #${r.pr.number}  ${r.pr.title.slice(0, 56)}` +
      (r.ok ? '' : `\n      ↳ ${r.reason}`),
  )
}
const bad = results.filter((r) => !r.ok)
console.log(`\n过闸门 ${results.length - bad.length} / ${results.length}。`)
if (bad.length) {
  console.log(
    '\n❌ 的那些**不要合**。如果某个包是**有意留在低版本**的（Taro 生态常见），\n' +
      '   应该在 .github/dependabot.yml 里给它加 ignore 并写明理由 ——\n' +
      '   否则它每周都会再提一次，每次都要靠人记得拒绝。',
  )
}
if (KEEP && created.length) console.log(`\n(--keep) worktree 保留在：\n${created.join('\n')}`)
