#!/usr/bin/env node
/**
 * 生成 `cloudfunctions/supabase-proxy-dev/`（云开发里的**第二个部署位**）。
 *
 * 用法：
 *   node scripts/sync-cloudfunctions.mjs          生成 / 覆盖
 *   node scripts/sync-cloudfunctions.mjs --check  只校验是否已同步（不改文件）
 *
 * ## 为什么要有第二个函数
 *
 * 反代的上游是环境变量 `SUPABASE_URL` 决定的，而**一个云函数只有一套环境变量**。
 * 所以「dev 线的请求打到开发库」这件事没法靠一个函数做到——得有两个部署位，
 * 各自配自己的上游。HTTP 访问服务那边再配一条 `/dev` 路由指过来。
 *
 * ## 为什么是生成而不是两个手维护的目录
 *
 * 两份代码**必须逐字相同**（差异只在控制台的环境变量），手维护必然漂移，而漂移的
 * 后果是「dev 上验的是一份和线上不一样的代码」——那正是分环境想避免的事。
 * 反过来，在仓库里放两份一模一样的 600 多行代码则是纯负债。
 * 所以：`supabase-proxy/` 是唯一源码，`supabase-proxy-dev/` 是生成物、不入库（见 .gitignore）。
 *
 * ⚠️ **改了源码就要重跑本脚本再部署**，否则 dev 侧停在旧代码上。生成文件头部带源码哈希，
 * 陈旧与否一眼可辨；`--check` 就是拿它来做机械判定的。
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_DIR = join(root, 'cloudfunctions', 'supabase-proxy')
const DST_DIR = join(root, 'cloudfunctions', 'supabase-proxy-dev')
const ENTRY = 'index.js'

const checkOnly = process.argv.includes('--check')

if (!existsSync(SRC_DIR)) {
  console.error(`✗ 找不到源码目录：${relative(root, SRC_DIR)}`)
  process.exit(1)
}

/** 源码里除去要加头的那份之外，其余文件原样搬运（目前只有 package.json） */
const sourceFiles = readdirSync(SRC_DIR).filter((name) => name !== ENTRY)
const entrySource = readFileSync(join(SRC_DIR, ENTRY), 'utf8')
const hash = createHash('sha256').update(entrySource).digest('hex').slice(0, 12)

/**
 * 生成物 = 头部说明 + 源码原文。
 *
 * 头里那行哈希是给「部署前瞄一眼」和 `--check` 用的：**它是源码的哈希，不是生成物的**，
 * 所以陈旧时能立刻看出来——生成物本身没法自证新旧。
 */
function generatedEntry() {
  return [
    '// ⚠️ 自动生成，不要手改 —— 改 ../supabase-proxy/index.js 后重跑：',
    '//      node scripts/sync-cloudfunctions.mjs',
    `// 源码 supabase-proxy/index.js 的 sha256 前 12 位：${hash}`,
    '// 上游由云开发控制台的环境变量 SUPABASE_URL 决定（本文件不含任何环境判断）。',
    '',
    entrySource,
  ].join('\n')
}

/** @type {{ path: string, content: string, label: string }[]} */
const expected = [
  { path: join(DST_DIR, ENTRY), content: generatedEntry(), label: ENTRY },
  ...sourceFiles.map((name) => ({
    path: join(DST_DIR, name),
    content: readFileSync(join(SRC_DIR, name), 'utf8'),
    label: name,
  })),
]

if (checkOnly) {
  const stale = expected.filter(({ path, content }) => {
    if (!existsSync(path)) return true
    return readFileSync(path, 'utf8') !== content
  })
  if (stale.length) {
    console.error(
      `✗ ${relative(root, DST_DIR)} 与源码不同步（${stale.map((s) => s.label).join(', ')}）\n` +
        '  跑一次：node scripts/sync-cloudfunctions.mjs'
    )
    process.exit(1)
  }
  process.stdout.write(`✓ supabase-proxy-dev/ 与源码同步（源码哈希 ${hash}）\n`)
  process.exit(0)
}

mkdirSync(DST_DIR, { recursive: true })
for (const { path, content } of expected) writeFileSync(path, content, 'utf8')

process.stdout.write(
  `✓ 已生成 ${relative(root, DST_DIR)}/（源码哈希 ${hash}）\n` +
    '  接下来在微信开发者工具里右键该目录 → 上传并部署，并在云开发控制台配好它的环境变量\n' +
    '  （SUPABASE_URL 指开发库、SUPABASE_ANON_KEY 用开发库的 publishable key、PROBE_TAG 换个名字、BASE_PATH 填路由前缀）\n'
)
