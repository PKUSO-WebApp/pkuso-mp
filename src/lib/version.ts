import Taro from '@tarojs/taro'

export type AppEnv = 'develop' | 'trial' | 'release' | 'unknown'

function readMiniProgram(): { envVersion?: AppEnv; version?: string } {
  try {
    const info = (Taro.getAccountInfoSync?.() as { miniProgram?: { envVersion?: AppEnv; version?: string } } | undefined)
    return info?.miniProgram ?? {}
  } catch {
    return {}
  }
}

export function getAppEnv(): AppEnv {
  return readMiniProgram().envVersion ?? 'unknown'
}

/**
 * 版本标签：跟随微信上传时填写的版本号（无需手工维护常量）。
 * 开发版/体验版/正式版分别展示「开发版」「体验版 vX」「正式版 vY」；
 * 取不到（如单测环境）回退「开发版」。
 */
export function getAppVersionLabel(): string {
  // APP_VERSION 由编译期 defineConstants 注入（package.json version）；
  // 单测环境未注入时回退占位值，避免运行时引用错误。
  const appVersion = typeof APP_VERSION !== 'undefined' ? APP_VERSION : '0.0.0'
  const env = getAppEnv()
  const envLabel =
    env === 'release' ? '正式版' : env === 'trial' ? '体验版' : env === 'develop' ? '开发版' : ''
  return envLabel ? `${envLabel} v${appVersion}` : `v${appVersion}`
}
