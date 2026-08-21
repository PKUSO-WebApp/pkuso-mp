// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { RehearsalRow } from '@/types/database'
import { getAttendanceDisplay, RehearsalDetailModal } from './rehearsal-detail-modal'

vi.mock('@tarojs/components', () => {
  const create = (tag: string) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span'), Button: create('button') }
})

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, children }: any) => (open ? React.createElement('div', null, children) : null),
}))

afterEach(() => {
  cleanup()
})

// 用固定「很久以前」的排练构造已结束场景（getSignBlockReason 取运行时刻）
const endedRehearsal = {
  id: 1,
  start_time: '2020-01-01T10:00:00',
  end_time: '2020-01-01T12:00:00',
} as unknown as RehearsalRow

// 用固定「很久以后」的排练构造未结束场景
const upcomingRehearsal = {
  id: 2,
  start_time: '2099-01-01T10:00:00',
  end_time: '2099-01-01T12:00:00',
} as unknown as RehearsalRow

describe('getAttendanceDisplay 出勤状态五行映射', () => {
  it('考勤加载中显示占位符', () => {
    expect(getAttendanceDisplay(endedRehearsal, null, true).label).toBe('…')
  })

  it('excused → 请假（无论是否签到，状态已定）', () => {
    const r = getAttendanceDisplay(
      upcomingRehearsal,
      { status: 'excused', sign_in_time: null },
      false
    )
    expect(r.label).toBe('请假')
    expect(r.className).toBe('text-info')
  })

  it('管理员显式设置的出席/迟到按 STATUS_LABEL 展示', () => {
    expect(
      getAttendanceDisplay(upcomingRehearsal, { status: 'present', sign_in_time: null }, false)
        .label
    ).toBe('出席')
    expect(
      getAttendanceDisplay(upcomingRehearsal, { status: 'late', sign_in_time: null }, false).label
    ).toBe('迟到')
  })

  it('已签到 → 出勤状态；签到后被改状态的按 STATUS_LABEL 展示', () => {
    expect(
      getAttendanceDisplay(
        upcomingRehearsal,
        { status: 'present', sign_in_time: '2026-01-01T10:00:00' },
        false
      ).label
    ).toBe('出席')
    // 已签到但状态未知/空 → 兜底缺勤
    expect(
      getAttendanceDisplay(
        upcomingRehearsal,
        { status: '', sign_in_time: '2026-01-01T10:00:00' },
        false
      ).label
    ).toBe('缺勤')
  })

  it('未签到 + 已结束 → 缺勤', () => {
    const r = getAttendanceDisplay(endedRehearsal, null, false)
    expect(r.label).toBe('缺勤')
    expect(r.className).toBe('text-danger')
  })

  it('未签到 + 未结束 → 未签到（无状态色）', () => {
    const r = getAttendanceDisplay(upcomingRehearsal, null, false)
    expect(r.label).toBe('未签到')
    expect(r.className).toBe('')
  })
})

describe('请假入口文案（Issue #175）', () => {
  it('已结束排练显示「我要补请假 ＞」', () => {
    render(
      <RehearsalDetailModal item={endedRehearsal} onClose={() => {}} onRequestLeave={() => {}} />
    )
    expect(screen.getByText('我要补请假 ＞')).toBeTruthy()
    expect(screen.queryByText('我要请假 ＞')).toBeNull()
  })

  it('未结束排练显示「我要请假 ＞」', () => {
    render(
      <RehearsalDetailModal item={upcomingRehearsal} onClose={() => {}} onRequestLeave={() => {}} />
    )
    expect(screen.getByText('我要请假 ＞')).toBeTruthy()
    expect(screen.queryByText('我要补请假 ＞')).toBeNull()
  })
})
