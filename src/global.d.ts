// 编译期由 config/index.ts 的 defineConstants 注入（取自 package.json version）。
declare const APP_VERSION: string
// 是否显示环境标签（开发版/体验版/正式版），'false' 时仅显示版本号。
declare const SHOW_ENV_LABEL: string | undefined

// 微信小程序原生 API（Taro 类型定义未覆盖的部分）
declare const wx: {
  hideShareMenu(options?: Record<string, never>): void
  showShareMenu(options: { menus: string[] }): void
}
