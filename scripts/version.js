#!/usr/bin/env node
/**
 * 版本号管理脚本
 *
 * 用法：
 *   node scripts/version.js dev      → 0.1.5 → 0.1.5-dev.1
 *   node scripts/version.js rc       → 0.1.5 → 0.1.5-rc.1
 *   node scripts/version.js release  → 0.1.5-dev.1 或 0.1.5-rc.1 → 0.1.5
 *   node scripts/version.js bump     → 0.1.5 → 0.1.6（patch 升级）
 *   node scripts/version.js major    → 0.1.5 → 1.0.0（major 升级）
 *   node scripts/version.js minor    → 0.1.5 → 0.2.0（minor 升级）
 *   node scripts/version.js          → 显示当前版本
 */

import fs from 'node:fs'
import path from 'node:path'

const pkgPath = path.resolve(process.cwd(), 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
const current = pkg.version

function parseVersion(v) {
  const match = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-(\w+)\.(\d+))?$/)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
    prereleaseNum: match[5] ? Number(match[5]) : 0,
  }
}

function formatVersion(major, minor, patch, pre, preNum) {
  if (pre && preNum !== undefined) return `${major}.${minor}.${patch}-${pre}.${preNum}`
  return `${major}.${minor}.${patch}`
}

const action = process.argv[2]
const parsed = parseVersion(current)

if (!parsed) {
  console.error(`❌ 无法解析版本号: ${current}`)
  process.exit(1)
}

let newVersion = current

switch (action) {
  case 'dev': {
    const overrideNum = process.env.DEV_VERSION_NUM
    if (overrideNum) {
      newVersion = formatVersion(parsed.major, parsed.minor, parsed.patch, 'dev', Number(overrideNum))
    } else if (parsed.prerelease === 'dev') {
      newVersion = formatVersion(parsed.major, parsed.minor, parsed.patch, 'dev', parsed.prereleaseNum + 1)
    } else {
      newVersion = formatVersion(parsed.major, parsed.minor, parsed.patch, 'dev', 1)
    }
    break
  }
  case 'rc': {
    if (parsed.prerelease === 'rc') {
      newVersion = formatVersion(parsed.major, parsed.minor, parsed.patch, 'rc', parsed.prereleaseNum + 1)
    } else {
      newVersion = formatVersion(parsed.major, parsed.minor, parsed.patch, 'rc', 1)
    }
    break
  }
  case 'release': {
    newVersion = formatVersion(parsed.major, parsed.minor, parsed.patch)
    break
  }
  case 'bump':
  case 'patch': {
    newVersion = formatVersion(parsed.major, parsed.minor, parsed.patch + 1)
    break
  }
  case 'minor': {
    newVersion = formatVersion(parsed.major, parsed.minor + 1, 0)
    break
  }
  case 'major': {
    newVersion = formatVersion(parsed.major + 1, 0, 0)
    break
  }
  default: {
    console.log(`当前版本: ${current}`)
    console.log(`
用法:
  node scripts/version.js dev      → 添加/递增 dev 后缀 (0.1.5 → 0.1.5-dev.1)
  node scripts/version.js rc       → 添加/递增 rc 后缀 (0.1.5 → 0.1.5-rc.1)
  node scripts/version.js release  → 去除预发布后缀 (0.1.5-rc.1 → 0.1.5)
  node scripts/version.js patch    → 补丁升级 (0.1.5 → 0.1.6)
  node scripts/version.js minor    → 次版本升级 (0.1.5 → 0.2.0)
  node scripts/version.js major    → 主版本升级 (0.1.5 → 1.0.0)
`)
    process.exit(0)
  }
}

pkg.version = newVersion
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`✅ ${current} → ${newVersion}`)
