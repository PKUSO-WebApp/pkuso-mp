// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { ThemeProvider, useThemeContext } from './theme-context'

const { storage } = vi.hoisted(() => ({ storage: {} as Record<string, unknown> }))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: (k: string) => storage[k] ?? '',
    setStorageSync: (k: string, v: unknown) => {
      storage[k] = v
    },
    setStorage: async ({ key, data }: { key: string; data: unknown }) => {
      storage[key] = data
    },
    getSystemInfoSync: () => ({ theme: 'light' }),
    onThemeChange: () => {},
    offThemeChange: () => {},
    setNavigationBarColor: () => Promise.resolve(),
    setBackgroundColor: () => Promise.resolve(),
  },
}))

function Consumer() {
  const { preference, mode, setPreference } = useThemeContext()
  return (
    <div>
      <span data-testid='pref'>{preference}</span>
      <span data-testid='mode'>{mode}</span>
      <button onClick={() => setPreference('dark')}>toDark</button>
      <button onClick={() => setPreference('light')}>toLight</button>
      <button onClick={() => setPreference('system')}>toSystem</button>
    </div>
  )
}

describe('ThemeProvider 切换（P3-3）', () => {
  beforeEach(() => {
    for (const k of Object.keys(storage)) delete storage[k]
  })
  afterEach(cleanup)

  it('默认 preference=system，mode 跟随系统（light）', () => {
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>
    )
    expect(screen.getByTestId('pref').textContent).toBe('system')
    expect(screen.getByTestId('mode').textContent).toBe('light')
  })

  it('setPreference(dark) 即时切换并持久化', async () => {
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>
    )
    await act(async () => {
      screen.getByText('toDark').click()
    })
    expect(screen.getByTestId('pref').textContent).toBe('dark')
    expect(screen.getByTestId('mode').textContent).toBe('dark')
    expect(storage['pkuso-theme']).toBe('dark')
  })

  it('setPreference(light) → mode=light', async () => {
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>
    )
    await act(async () => {
      screen.getByText('toLight').click()
    })
    expect(screen.getByTestId('mode').textContent).toBe('light')
  })

  it('setPreference(system) → mode 跟随系统（light）', async () => {
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>
    )
    await act(async () => {
      screen.getByText('toSystem').click()
    })
    expect(screen.getByTestId('pref').textContent).toBe('system')
    expect(screen.getByTestId('mode').textContent).toBe('light')
  })
})
