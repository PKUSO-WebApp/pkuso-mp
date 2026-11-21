// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DateTimePicker } from './DateTimePicker'

vi.mock('@tarojs/components', () => {
  const create = (tag: string) => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  // 把原生 picker 的 change 翻译成 Taro 的 { detail: { value } }
  const Picker = (props: any) =>
    React.createElement(
      'div',
      {
        'data-mode': props.mode,
        onClick: () =>
          props.onChange?.({
            detail: { value: props.mode === 'date' ? '2026-01-02' : [20, 1] },
          }),
      },
      props.children
    )
  return { View: create('div'), Text: create('span'), Picker }
})

afterEach(() => {
  cleanup()
})

describe('DateTimePicker', () => {
  it('multiSelector 模式下未传 onTimeMultiChange 时回落到 onTimeChange（团长页的原 bug）', () => {
    const onDateChange = vi.fn()
    const onTimeChange = vi.fn()
    render(
      <DateTimePicker
        date='2026-01-01'
        time='19:00'
        onDateChange={onDateChange}
        onTimeChange={onTimeChange}
      />
    )

    const timePicker = screen.getByText('19:00').closest('[data-mode="multiSelector"]')!
    fireEvent.click(timePicker)

    expect(onTimeChange).toHaveBeenCalledWith('20:15')
  })

  it('传了 onTimeMultiChange 时以它为准，不再调用 onTimeChange', () => {
    const onTimeChange = vi.fn()
    const onTimeMultiChange = vi.fn()
    render(
      <DateTimePicker
        date='2026-01-01'
        time='19:00'
        onDateChange={vi.fn()}
        onTimeChange={onTimeChange}
        onTimeMultiChange={onTimeMultiChange}
      />
    )

    fireEvent.click(screen.getByText('19:00').closest('[data-mode="multiSelector"]')!)

    expect(onTimeMultiChange).toHaveBeenCalledWith([20, 1])
    expect(onTimeChange).not.toHaveBeenCalled()
  })

  it('日期选择器仍走 onDateChange', () => {
    const onDateChange = vi.fn()
    render(
      <DateTimePicker
        date='2026-01-01'
        time='19:00'
        onDateChange={onDateChange}
        onTimeChange={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText('2026-01-01').closest('[data-mode="date"]')!)

    expect(onDateChange).toHaveBeenCalledWith('2026-01-02')
  })
})
