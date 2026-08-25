// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { translate } from './index'
import { zhCN } from './messages/zh-CN'
import type { Dict } from './types'

vi.mock('@tarojs/taro', () => ({
  default: {
    getAppBaseInfo: () => ({ language: 'zh-CN' }),
    getStorageSync: () => null,
    setStorageSync: () => {},
  },
}))

describe('i18n translate', () => {
  it('返回嵌套文案', () => {
    expect(translate(zhCN as Dict, 'profile.settings.language')).toBe('语言设置')
  })

  it('支持插值', () => {
    const d = { hi: '你好 {name}' } as Dict
    expect(translate(d, 'hi', { name: 'A' })).toBe('你好 A')
  })

  it('缺失 key 回退到 key 本身', () => {
    expect(translate({} as Dict, 'missing.key')).toBe('missing.key')
  })
})
