#!/usr/bin/env node
/**
 * 创建功能分支并自动更新版本号
 * 用法: node scripts/create-branch.js <patch|minor|major> <描述>
 * 示例: node scripts/create-branch.js patch 修复登录bug
 *       node scripts/create-branch.js minor 添加消息通知功能
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const VERSION_TYPE = process.argv[2]
const DESCRIPTION = process.argv[3]
const VALID_TYPES = ['patch', 'minor', 'major']

if (!VERSION_TYPE || !VALID_TYPES.includes(VERSION_TYPE)) {
  console.error('用法: node scripts/create-branch.js <patch|minor|major> <描述>')
  console.error('示例: node scripts/create-branch.js patch 修复登录bug')
  process.exit(1)
}

if (!DESCRIPTION) {
  console.error('请提供分支描述，例如: node scripts/create-branch.js minor 添加消息通知')
  process.exit(1)
}

// 版本号计算交给 version.js——它是这份逻辑的唯一实现（CI 的 dev/prod 部署也用它）。
// 本文件原先自己 split('.').map(Number) 解析：遇到带预发布后缀的版本号
// （如 0.4.26-dev.1）会得出 patch = NaN，把版本写成 0.4.NaN。而 AGENTS.md 的
// 发布流程第 1 步恰好是 `pnpm version:dev`，照文档走就会踩到。
// version.js 的 action 与本脚本的 VERSION_TYPE 同名（patch / minor / major），直接透传。
const packagePath = path.join(__dirname, '..', 'package.json')
const readVersion = () => JSON.parse(fs.readFileSync(packagePath, 'utf8')).version

const oldVersion = readVersion()
execSync(`node "${path.join(__dirname, 'version.js')}" ${VERSION_TYPE}`, { stdio: 'inherit' })
const newVersion = readVersion()

console.log(`✓ 版本号已更新: ${oldVersion} → ${newVersion}`)

// 创建分支名（冒号在 git 分支名中无效，改用斜杠）
const branchName = `${VERSION_TYPE}/${DESCRIPTION}`

// 创建并切换分支
try {
  execSync(`git checkout -b "${branchName}"`, { stdio: 'inherit' })
  console.log(`✓ 已创建并切换到分支: ${branchName}`)

  // 提交版本号变更
  execSync('git add package.json', { stdio: 'inherit' })
  execSync(`git commit -m "chore: bump version to ${newVersion}"`, { stdio: 'inherit' })
  console.log(`✓ 版本号变更已提交`)

  // 创建本地 tag（不推送远程，发布时由 CI 统一推送）
  try {
    execSync(`git tag v${newVersion}`, { stdio: 'inherit' })
    console.log(`✓ 已创建 tag: v${newVersion}`)
  } catch {
    console.log(`⚠ tag v${newVersion} 已存在，跳过创建`)
  }
} catch (error) {
  console.error('分支操作失败:', error.message)
  process.exit(1)
}
