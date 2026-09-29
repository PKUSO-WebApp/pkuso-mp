#!/usr/bin/env node
/**
 * 交付闸门（**本仓库闸门的唯一定义**）。
 *
 * 用法：
 *   pnpm gate           本地：跑闸门 → 再出一份 **dev 版 dist/** 供验收
 *   pnpm gate --ci      CI：只跑闸门，不出 dev 版（CI 不需要人验收）
 *   pnpm gate --skip-build   只跑 lint/typecheck/test（改文档时想快一点）
 *
 * ## 为什么需要它（不是为了少打几个字）
 *
 * 1. **「跑完闸门」和「能验收」是两件事，而文档混着讲。**
 *    `pnpm build:weapp` 按 NODE_ENV=production 读 `.env.production` ——
 *    **跑完闸门留下的是一个连生产库的 `dist/`**。谁在开发者工具里点开它，
 *    看到的就是生产数据。AGENTS.md §1.3 专门警告过这件事，但那是一段散文：
 *    本脚本把「跑完闸门之后必须再出一次 dev 版」变成**默认行为**，不用记。
 *
 * 2. **闸门的顺序与集合散在三处**：AGENTS.md §1.2（build → typecheck → lint → test）、
 *    CONTRIBUTING.md（同）、CI（lint → typecheck → test → build）。三者集合相同、顺序不同。
 *    现在只有一个地方写了顺序，CI 与人都调它。
 *
 * 3. 交付后要提醒人在开发者工具里清缓存 —— 那是人肉步骤，脚本替不了，所以打印出来。
 *
 * ## 顺序说明
 *
 * 先 lint/typecheck/test（快，失败得早），最后 build（慢）。这与 CI 一致
 * （AGENTS.md 里那张表按「1.构建 2.typecheck 3.lint 4.test」列，顺序不同、集合相同）。
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, readdirSync } from 'node:fs'

const args = process.argv.slice(2)
const isCI = args.includes('--ci')
const skipBuild = args.includes('--skip-build')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 跑一条 pnpm 脚本；失败即整个闸门失败（不吞错） */
function run(script, label) {
  process.stdout.write(`\n\u001b[1m▶ ${label}\u001b[0m\n`)
  const r = spawnSync('pnpm', [script], { cwd: root, stdio: 'inherit', shell: true })
  if (r.status !== 0) {
    process.stdout.write(`\n\u001b[31m✗ 闸门失败于：${label}\u001b[0m\n`)
    process.exit(r.status ?? 1)
  }
}

const steps = [
  ['lint', 'lint（eslint --max-warnings 0）'],
  ['typecheck', 'typecheck（tsc --noEmit）'],
  ['test', 'test（vitest run）'],
]
if (!skipBuild) steps.push(['build:weapp', 'build（生产环境构建，与 CI 相同）'])

for (const [script, label] of steps) run(script, label)

process.stdout.write('\n\u001b[32m✓ 闸门全过\u001b[0m\n')

if (skipBuild) process.exit(0)

// ---- 闸门之后 ----

if (isCI) {
  // CI 里 dist/ 只用于确认能构建，不需要给人验收，也不该多花一次构建时间
  process.exit(0)
}

process.stdout.write(
  '\n\u001b[33m⚠️  刚才那次 build:weapp 读的是 .env.production —— 现在的 dist/ 连的是【生产库】。\u001b[0m\n' +
    '   在开发者工具里点开它＝直接看生产数据。下面补一次开发环境构建。\n',
)

run('dev:weapp', 'build（开发环境，供验收）')

/**
 * 核对 dist/ 到底连的哪个库（AGENTS.md §1.3 那条 `grep -rl` 的跨平台版本）。
 *
 * 为什么不用 grep：本脚本要在 Windows 上跑，而 cmd 里不一定有 grep。
 * 为什么值得核：**构建环境错了不会报任何错** —— 拿一份连生产库的包去验收，
 * 看到的「问题」可能全是数据造成的假象。
 */
function distMatches(needle, dir, budget = { files: 3000, bytes: 8 * 1024 * 1024 }) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const e of entries) {
    if (budget.files <= 0 || budget.bytes <= 0) return false
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (distMatches(needle, p, budget)) return true
      continue
    }
    // 只扫可能内联了配置的文本类产物
    if (!/\.(js|json|wxml|wxss|wxs|css|html)$/.test(e.name)) continue
    budget.files--
    try {
      const text = readFileSync(p, 'utf8')
      budget.bytes -= text.length
      if (text.includes(needle)) return true
    } catch {
      /* 读不了就跳过（二进制等） */
    }
  }
  return false
}

let dbHint = '(没有 .env.development，无法核对 dist/ 连的是哪个库)'
try {
  const url = readFileSync(join(root, '.env.development'), 'utf8')
    .match(/^TARO_APP_SUPABASE_URL=(.*)$/m)?.[1]
    ?.trim()
  if (url) {
    dbHint = distMatches(url, join(root, 'dist'))
      ? `✓ dist/ 已确认指向【开发库】(${url})`
      : `⚠️ 没在 dist/ 里找到开发库地址 —— 这份 dist/ 可能仍是生产版，请手工核对（AGENTS.md §1.3）`
  }
} catch {
  /* .env.development 不在（未 cp）时保持上面的提示 */
}

process.stdout.write(
  `\n\u001b[32m✓ 可以验收了\u001b[0m\n` +
    `   ${dbHint}\n` +
    '   在微信开发者工具里：设置 → 通用 → 清空缓存 / 重开项目。\n' +
    '   若只想重出这一份 dev 版：pnpm dev:weapp\n',
)
