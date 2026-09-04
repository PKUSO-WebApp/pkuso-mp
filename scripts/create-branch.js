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

// 读取 package.json
const packagePath = path.join(__dirname, '..', 'package.json')
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))

const [major, minor, patch] = packageJson.version.split('.').map(Number)

let newVersion
switch (VERSION_TYPE) {
  case 'major':
    newVersion = `${major + 1}.0.0`
    break
  case 'minor':
    newVersion = `${major}.${minor + 1}.0`
    break
  case 'patch':
    newVersion = `${major}.${minor}.${patch + 1}`
    break
}

// 更新 package.json
const oldVersion = packageJson.version
packageJson.version = newVersion
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n')

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
} catch (error) {
  console.error('分支操作失败:', error.message)
  process.exit(1)
}
