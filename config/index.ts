import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin'
import fs from 'node:fs'
import path from 'node:path'
import webpack from 'webpack'
import { WeappTailwindcss } from 'weapp-tailwindcss/webpack'
import devConfig from './dev'
import prodConfig from './prod'

// 版本号单一来源：package.json 的 version，编译期注入为全局常量 APP_VERSION，
// 页面「我的」页脚与「问题与反馈」弹窗始终展示（如「开发版 v1.0.0」），
// 不再依赖微信上传后才填充的 miniProgram.version（开发版为空 → 只显示「开发版」）。
const appVersion = (
  JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8')) as {
    version: string
  }
).version

// https://taro-docs.jd.com/docs/next/config#defineconfig-辅助函数
export default defineConfig<'webpack5'>(async (merge) => {
  const weappTailwindcssOptions = {
    appType: 'taro',
    tailwindcssBasedir: process.cwd(),
    cssOptions: {
      rem2rpx: true,
    },
    cssEntries: [path.resolve(process.cwd(), 'src/app.css')],
  }
  const baseConfig: UserConfigExport<'webpack5'> = {
    projectName: 'pkuso-miniprogram',
    date: '2026-8-19',
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2,
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    plugins: ['@tarojs/plugin-generator'],
    defineConstants: { APP_VERSION: JSON.stringify(appVersion) },
    copy: {
      patterns: [],
      options: {},
    },
    framework: 'react',
    compiler: 'webpack5',
    cache: {
      enable: false, // Webpack 持久化缓存配置，建议开启。默认配置请参考：https://docs.taro.zone/docs/config-detail#cache
    },
    mini: {
      postcss: {
        pxtransform: {
          enable: true,
          config: {},
        },
        cssModules: {
          enable: false, // 默认为 false，如需使用 css modules 功能，则设为 true
          config: {
            namingPattern: 'module', // 转换模式，取值为 global/module
            generateScopedName: '[name]__[local]___[hash:base64:5]',
          },
        },
      },
      webpackChain(chain) {
        chain.resolve.plugin('tsconfig-paths').use(TsconfigPathsPlugin)
        // 每次构建前清空 dist：防止 watch 增量构建残留旧 chunk，导致开发者工具
        // 混合加载新旧产物（模块 ID 漂移 → 运行时 n[e] is not a function）。
        // Taro 的 Output 类型未收录 clean 字段，用 set 绕过类型检查
        chain.output.set('clean', true)
        // 真机兼容：@supabase/* 产物含 `?.`/`??` 等现代语法（supabase-js 被解析到
        // dist/umd 自包含包，auth-js 主产物同样含现代语法）。Taro mini 的 babel-loader
        // 默认只转译 src 与 @tarojs/*，这里把 @supabase 目录加入 script 规则的
        // include，经 babel 转译到 ES5（转译目标见 babel.config.js 的 targets），
        // 避免真机 JSCore 解析失败（开发者工具 V8 能跑，真机报 SyntaxError）。
        // 注：不能用顶层 compile.include 配置——Taro 服务层对 config 键白名单过滤，
        // compile 键不会传到 runner；webpackChain 运行于模块规则合并之后，
        // chain.module.rule('script') 此时已存在。
        chain.module
          .rule('script')
          .include.add((filename: string) =>
            /node_modules[\\/](@supabase|iceberg-js)/.test(filename)
          )
        // 小程序环境无 Node.js process 全局变量，@supabase 等依赖运行时引用 process 导致崩溃。
        // 通过 ProvidePlugin 注入 process/browser polyfill。
        chain.plugin('process-polyfill').use(webpack.ProvidePlugin, [
          {
            process: 'process/browser',
          },
        ])
        chain.merge({
          plugin: {
            install: {
              plugin: WeappTailwindcss,
              args: [weappTailwindcssOptions],
            },
          },
        })
      },
    },
    h5: {
      publicPath: '/',
      staticDirectory: 'static',
      output: {
        filename: 'js/[name].[hash:8].js',
        chunkFilename: 'js/[name].[chunkhash:8].js',
      },
      miniCssExtractPluginOption: {
        ignoreOrder: true,
        filename: 'css/[name].[hash].css',
        chunkFilename: 'css/[name].[chunkhash].css',
      },
      postcss: {
        autoprefixer: {
          enable: true,
          config: {},
        },
        cssModules: {
          enable: false, // 默认为 false，如需使用 css modules 功能，则设为 true
          config: {
            namingPattern: 'module', // 转换模式，取值为 global/module
            generateScopedName: '[name]__[local]___[hash:base64:5]',
          },
        },
      },
      webpackChain(chain) {
        chain.resolve.plugin('tsconfig-paths').use(TsconfigPathsPlugin)
        chain.merge({
          plugin: {
            install: {
              plugin: WeappTailwindcss,
              args: [weappTailwindcssOptions],
            },
          },
        })
      },
    },
    rn: {
      appName: 'taroDemo',
      postcss: {
        cssModules: {
          enable: false, // 默认为 false，如需使用 css modules 功能，则设为 true
        },
      },
    },
  }

  if (process.env.NODE_ENV === 'development') {
    // 本地开发构建配置（不混淆压缩）
    return merge({}, baseConfig, devConfig)
  }
  // 生产构建配置（默认开启压缩混淆等）
  return merge({}, baseConfig, prodConfig)
})
