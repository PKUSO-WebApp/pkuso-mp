import { describe, expect, it } from 'vitest'
import type { TFn } from '@/i18n'
import { deviceNameOf, noticeText } from './notification-text'

// 桩：回显 key，插值也一并渲染出来 —— 断言只看 key 与参数，不吃文案（文案会改）
const t = ((key: string, params?: Record<string, string | number>) =>
  params
    ? `${key}(${Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')})`
    : key) as unknown as TFn

const row = {
  kind: 'device_login' as string | null,
  meta: { deviceName: 'SM-S9260 · Android 16' } as unknown,
  title: '新设备登录',
  content: '服务端的兜底正文',
}

describe('noticeText：一条通知按当前语言渲染', () => {
  it('kind=device_login ⇒ 走 i18n，设备名与时刻都传进去', () => {
    expect(noticeText(row, '2026-10-16 11:47', t)).toEqual({
      title: 'notification.kind.deviceLogin.title',
      content:
        'notification.kind.deviceLogin.body(name=SM-S9260 · Android 16,time=2026-10-16 11:47)',
    })
  })

  it('设备名为空 ⇒ 用 i18n 的「未知设备」，**不是**服务端那句中文', () => {
    const r = { ...row, meta: { deviceName: null } }
    expect(noticeText(r, '2026-10-16 11:47', t).content).toBe(
      'notification.kind.deviceLogin.body(name=notification.kind.deviceLogin.unknownDevice,time=2026-10-16 11:47)'
    )
  })

  it('meta 缺失 / 形状不对 / 空串 ⇒ 都收敛成「未知设备」', () => {
    for (const meta of [null, undefined, {}, 'device_login', { deviceName: '   ' }]) {
      expect(noticeText({ ...row, meta }, 't', t).content).toContain(
        'name=notification.kind.deviceLogin.unknownDevice'
      )
    }
  })

  it('老行（kind 为 null）⇒ 原样显示服务端文案（不猜、不丢）', () => {
    expect(noticeText({ ...row, kind: null, meta: null }, 't', t)).toEqual({
      title: '新设备登录',
      content: '服务端的兜底正文',
    })
  })

  it('认不得的 kind ⇒ 同样原样显示（服务端先上、客户端还没发版时不能白屏）', () => {
    expect(noticeText({ ...row, kind: 'some_future_kind' }, 't', t)).toEqual({
      title: '新设备登录',
      content: '服务端的兜底正文',
    })
  })
})

describe('deviceNameOf', () => {
  it('只认非空字符串，其余一律 null', () => {
    expect(deviceNameOf({ deviceName: 'iPad' })).toBe('iPad')
    expect(deviceNameOf({ deviceName: '' })).toBeNull()
    expect(deviceNameOf({ deviceName: 42 })).toBeNull()
    expect(deviceNameOf({})).toBeNull()
    expect(deviceNameOf(null)).toBeNull()
    expect(deviceNameOf([])).toBeNull()
  })
})
