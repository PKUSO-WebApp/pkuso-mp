// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { resetTestLocale, setTestLocale } from '@/test-utils/i18n-mock'
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
  const { createI18nMock } = await import('@/test-utils/i18n-mock')
  return createI18nMock()
})

afterEach(() => cleanup())

describe('StaffBlockedPage', () => {
  beforeEach(() => resetTestLocale())

  it('英文环境：管理员看到英文的「不提供管理端」文案', () => {
    setTestLocale('en')
    render(<StaffBlockedPage role='admin' />)
    expect(
      screen.getByText('Admin console is not available in the mini program. Please use the web app.')
    ).toBeTruthy()
    expect(screen.queryByText('不提供小程序管理端，请使用网页端')).toBeNull()
  })

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
