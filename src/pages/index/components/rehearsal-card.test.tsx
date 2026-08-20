// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { RehearsalRow } from '@/types/database'
import { RehearsalCard } from './rehearsal-card'

vi.mock('@tarojs/components', () => {
  const create = (tag: string) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span'), Button: create('button') }
})

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

const upcomingRehearsal = {
  id: 1,
  type: 'full',
  repertoire: '贝多芬第五交响曲',
  start_time: '2099-01-01T10:00:00',
  end_time: '2099-01-01T12:00:00',
  location: '排练厅',
  sign_in_code: '1234',
} as unknown as RehearsalRow

/** 本地时间 ISO 字符串（parseLocalISO 按本地时间解析，不能用 toISOString——那是 UTC） */
const localISO = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`

/** 签到窗口内的排练（开始 1 小时前、结束 2 小时后 → 签到按钮外显） */
const inWindowRehearsal = {
  ...upcomingRehearsal,
  start_time: localISO(new Date(Date.now() - 60 * 60 * 1000)),
  end_time: localISO(new Date(Date.now() + 2 * 60 * 60 * 1000)),
} as unknown as RehearsalRow

describe('RehearsalCard', () => {
  afterEach(cleanup)

  it('点击整卡触发 onClick', () => {
    const onClick = vi.fn()
    const { container } = render(
      <RehearsalCard item={upcomingRehearsal} attendanceLoading={false} onClick={onClick} />
    )
    fireEvent.click(container.firstElementChild!)
    expect(onClick).toHaveBeenCalled()
  })

  it('点击签到按钮不触发整卡点击（stopPropagation 阻断）', () => {
    const onClick = vi.fn()
    const onSignIn = vi.fn()
    const { getByText } = render(
      <RehearsalCard
        item={inWindowRehearsal}
        attendanceLoading={false}
        onClick={onClick}
        onSignIn={onSignIn}
      />
    )
    fireEvent.click(getByText('签到'))
    expect(onSignIn).toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('未传 onClick 时点击无副作用', () => {
    const { container } = render(
      <RehearsalCard item={upcomingRehearsal} attendanceLoading={false} />
    )
    fireEvent.click(container.firstElementChild!)
    // 不抛错即为通过
    expect(container.firstElementChild).toBeTruthy()
  })
})
