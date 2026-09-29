// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { StaffBlockedPage } from './staff-blocked-page'

vi.mock('@tarojs/components', () => {
  const create = (tag: any) => (props: any) => {
    const { hoverClass, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span') }
})
vi.mock('@tarojs/taro', () => ({ default: { reLaunch: vi.fn() } }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ signOut: vi.fn() }) }))
vi.mock('@/context/theme-context', () => ({ useThemeClass: () => '' }))

// 用**真词典**取词（不是把 t 桩成返回 key）：要断言的是用户真正看到的那句话
vi.mock('@/i18n', async () => {
  const mod = await import('@/i18n/messages/zh-CN')
  const dict = mod.zhCN as Record<string, unknown>
  const get = (k: string): string => {
    const val = k
      .split('.')
      .reduce<unknown>(
        (o, key) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[key] : undefined),
        dict
      )
    return typeof val === 'string' ? val : k
  }
  return { useT: () => ({ t: (k: string) => get(k), locale: 'zh-CN', setLocale: () => {} }) }
})

afterEach(() => cleanup())

describe('StaffBlockedPage', () => {
  it('admin 看到的仍是原来那套「不提供管理端」文案（不能被他人的改动带跑）', () => {
    render(<StaffBlockedPage role='admin' />)
    expect(screen.getByText('不提供小程序管理端，请使用网页端')).toBeTruthy()
  })

  it('谱务账号看到的是「专职账号」那套，不是管理端那套', () => {
    render(<StaffBlockedPage role='score_manager' />)

    expect(screen.getByText('本账号不提供小程序端，请使用网页端')).toBeTruthy()
    // 反向断言：给专职账号看「不提供小程序管理端」是错的（他不是管理员）
    expect(screen.queryByText('不提供小程序管理端，请使用网页端')).toBeNull()
  })

  it('未知角色走专职账号那套（与判据的失败关闭同向）', () => {
    render(<StaffBlockedPage role={null} />)
    expect(screen.getByText('本账号不提供小程序端，请使用网页端')).toBeTruthy()
    expect(screen.queryByText('不提供小程序管理端，请使用网页端')).toBeNull()
  })
})
