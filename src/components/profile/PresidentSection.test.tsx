// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { resetTestLocale, setTestLocale } from '@/test-utils/i18n-mock'
import { PresidentSection } from './PresidentSection'

const { positionState } = vi.hoisted(() => ({
  positionState: { value: null as string | null },
}))

vi.mock('@tarojs/components', () => {
  const create = (tag: string) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span') }
})

vi.mock('@tarojs/taro', () => ({
  default: { navigateTo: vi.fn() },
}))

vi.mock('@/hooks/useMyCapabilities', () => {
  const capabilities = new Set(['rehearsal'])
  return {
    useMyCapabilities: () => ({
      capabilities: ['rehearsal'],
      loading: false,
      refresh: vi.fn(),
      hasCapability: (capability: string) => capabilities.has(capability),
    }),
  }
})

vi.mock('@/hooks/useMyLeadershipPosition', () => ({
  useMyLeadershipPosition: () => ({
    position: positionState.value,
    loading: false,
  }),
}))

vi.mock('@/hooks/usePresidentPendingCounts', () => {
  const counts = { leave: 0, membership: 0, attendance: 0 }
  return {
    usePresidentPendingCounts: () => ({ counts, loading: false }),
  }
})

vi.mock('@/i18n', async () => {
  const { createI18nMock } = await import('@/test-utils/i18n-mock')
  return createI18nMock()
})

beforeEach(() => {
  resetTestLocale()
  positionState.value = null
})

afterEach(() => {
  cleanup()
})

describe('PresidentSection 标题', () => {
  it('团长显示「团长工作台」', () => {
    positionState.value = 'president'
    render(<PresidentSection />)
    expect(screen.getByText('团长工作台')).toBeTruthy()
  })

  it('副团长显示「副团长工作台」', () => {
    positionState.value = 'vice_president'
    render(<PresidentSection />)
    expect(screen.getByText('副团长工作台')).toBeTruthy()
  })

  it('有能力但无职位显示「团领导工作台」', () => {
    positionState.value = null
    render(<PresidentSection />)
    expect(screen.getByText('团领导工作台')).toBeTruthy()
  })

  it('英文环境：副团长标题', () => {
    setTestLocale('en')
    positionState.value = 'vice_president'
    render(<PresidentSection />)
    expect(screen.getByText('Vice President workspace')).toBeTruthy()
  })
})
