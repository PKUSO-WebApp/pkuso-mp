import Taro from '@tarojs/taro'

export type AppEnv = 'develop' | 'trial' | 'release' | 'unknown'

function readMiniProgram(): { envVersion?: AppEnv; version?: string } {
  try {
    const info = Taro.getAccountInfoSync?.() as
      { miniProgram?: { envVersion?: AppEnv; version?: string } } | undefined
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
 *
 * SHOW_ENV_LABEL 由编译期 defineConstants 注入，默认 true。
 * 设为 'false'（在 config/index.ts 或 .env 中配置）可隐藏环境标签，
 * 仅显示版本号如 "v0.1.0"。
 */
export function getAppVersionLabel(): string {
  const appVersion = typeof APP_VERSION !== 'undefined' ? APP_VERSION : '0.0.0'
  const showEnv = typeof SHOW_ENV_LABEL !== 'undefined' ? SHOW_ENV_LABEL !== 'false' : true
  if (!showEnv) return `v${appVersion}`

  const env = getAppEnv()
  const envLabel =
    env === 'release' ? '正式版' : env === 'trial' ? '体验版' : env === 'develop' ? '开发版' : ''
  return envLabel ? `${envLabel} v${appVersion}` : `v${appVersion}`
}
