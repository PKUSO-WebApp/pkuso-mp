#!/usr/bin/env node
/**
 * 微信小程序上传脚本
 * 用法: node scripts/upload.js [版本号] [描述]
 * 环境变量:
 *   WX_APPID - 小程序 AppID
 *   WX_PRIVATE_KEY_PATH - 上传密钥路径
 *   WX_UPLOAD_VERSION - 版本号（覆盖命令行参数）
 *   WX_UPLOAD_DESC - 上传描述（覆盖命令行参数）
 */
const ci = require('miniprogram-ci')
const fs = require('fs')
const path = require('path')

const APPID = process.env.WX_APPID || 'wx4813b0549427f8c3'
const PRIVATE_KEY_PATH =
  process.env.WX_PRIVATE_KEY_PATH || path.join(__dirname, '..', 'key', 'private.key')

// 检查密钥文件
if (!fs.existsSync(PRIVATE_KEY_PATH)) {
  console.error(`错误: 找不到上传密钥文件: ${PRIVATE_KEY_PATH}`)
  console.error('请从微信公众平台下载密钥并放置到 key/ 目录')
  console.error('路径: 微信公众平台 → 开发 → 开发设置 → 小程序代码上传 → 生成密钥')
  process.exit(1)
}

// 获取版本号
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
const version = process.env.WX_UPLOAD_VERSION || process.argv[2] || packageJson.version
const desc = process.env.WX_UPLOAD_DESC || process.argv[3] || `CI 上传 ${new Date().toISOString()}`

console.log(`上传信息:`)
console.log(`  AppID: ${APPID}`)
console.log(`  版本: ${version}`)
console.log(`  描述: ${desc}`)
console.log(`  密钥: ${PRIVATE_KEY_PATH}`)
console.log('')

async function upload() {
  try {
    const project = new ci.Project({
      appid: APPID,
      type: 'miniProgram',
      projectPath: path.join(__dirname, '..', 'dist'),
      privateKeyPath: PRIVATE_KEY_PATH,
      ignores: ['node_modules/**/*'],
    })

    console.log('开始上传...')

    const uploadResult = await ci.upload({
      project,
      version,
      desc,
      setting: {
        es6: true,
        minify: true,
        autoPrefixWXSS: true,
      },
      onProgressUpdate: (task) => {
        if (task._status === 'done') {
          console.log(`  ✓ ${task._msg}`)
        }
      },
    })

    console.log('')
    console.log('✓ 上传成功!')
    if (uploadResult) {
      console.log('  上传结果:', JSON.stringify(uploadResult, null, 2))
    }
  } catch (error) {
    console.error('')
    console.error('✗ 上传失败:', error.message)
    process.exit(1)
  }
}

upload()
