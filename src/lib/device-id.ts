import Taro from '@tarojs/taro'

// 设备身份：本地生成并持久化的随机 device_id，随 touch_session_v2 / get_my_session_v2 上报。
//
// ⚠️ **不能用 openid 当设备标识**：同一个人的手机和平板是**同一个 openid**，
// 拿它认设备等于把两台设备当成一台，多设备模型直接失效。
//
// 它的强度只到「给被动共享一道明确的门」：清缓存/重装会生成新 id，刻意绕过的人绕得过去
// （后端 migration 里写着同一条边界，别指望它更强）。

const DEVICE_ID_KEY = 'pkuso_device_id'
// 服务端约束：char_length(device_id) between 8 and 64（见 user_devices_device_id_len）
const MIN_DEVICE_ID_LEN = 8
const MAX_DEVICE_ID_LEN = 64

// 存储不可用时的进程内兜底：同一次运行内保持稳定——每次现生成会让「本机」在设备列表里认不出来
let memoryDeviceId: string | null = null

function randomSegment(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}

/** 生成一个满足服务端长度约束的随机设备 id（约 25 字符，纯小写字母数字） */
export function createDeviceId(): string {
  // d + 36 进制时间戳（可读、大致单调）+ 两段随机串（避免同一毫秒内两次生成相撞）
  return `d${Date.now().toString(36)}${randomSegment(8)}${randomSegment(8)}`
}

export function isValidDeviceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= MIN_DEVICE_ID_LEN &&
    value.length <= MAX_DEVICE_ID_LEN
  )
}

/**
 * 本机 device_id：首次调用生成并持久化，之后每次返回同一个值。
 * 存储里存的不是合法 id（过短/过长/被写坏）时重新生成——服务端有长度约束，坏值会让每次
 * touch 都报 bad_device_id，登录直接失败。
 */
export function getOrCreateDeviceId(): string {
  try {
    const stored = Taro.getStorageSync(DEVICE_ID_KEY)
    if (isValidDeviceId(stored)) return stored
  } catch {
    // 存储读不可用：落到下面的进程内兜底
  }
  const id = memoryDeviceId ?? createDeviceId()
  memoryDeviceId = id
  try {
    Taro.setStorageSync(DEVICE_ID_KEY, id)
  } catch {
    // 写不进去就只在本次运行内稳定（下次冷启动会换 id ⇒ 设备列表里可能多出一台，可接受）
  }
  return id
}

/**
 * 展示名（`机型 · 系统`，如 `iPhone · iOS 17.0`），由客户端给、服务端存进 user_devices.name。
 * 取不到时回退「未知设备」——与后端 migration 里那条通知的兜底文案一致。
 */
export function getDeviceName(): string {
  try {
    const info = Taro.getDeviceInfo?.() as { model?: string; system?: string } | undefined
    const parts = [String(info?.model ?? '').trim(), String(info?.system ?? '').trim()].filter(
      Boolean
    )
    if (parts.length > 0) return parts.join(' · ')
  } catch {
    // 落到下面的兜底
  }
  return '未知设备'
}

/** 平台标识（ios / android / devtools / windows / mac），取不到返回空串（服务端接受空值） */
export function getDevicePlatform(): string {
  try {
    const platform = (Taro.getDeviceInfo?.() as { platform?: string } | undefined)?.platform
    return typeof platform === 'string' ? platform : ''
  } catch {
    return ''
  }
}
