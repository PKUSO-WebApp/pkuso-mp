// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ToastProvider, useToast } from './Toast'

vi.mock('@tarojs/components', () => {
  const create = (tag: 'div' | 'span' | 'button') => (props: any) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span'), Button: create('button') }
})

/** 触发 toasts 的消费者：模拟业务方经 useToast 调用 */
function Trigger() {
  const toast = useToast()
  return (
    <button type='button' onClick={() => toast('操作成功', 'success')}>
      触发
    </button>
  )
}

function renderWithProvider() {
  return render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>
  )
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('useToast 触发后渲染 toast', () => {
    renderWithProvider()
    expect(screen.queryByText('操作成功')).toBeNull()
    fireEvent.click(screen.getByText('触发'))
    expect(screen.getByText('操作成功')).toBeTruthy()
  })

  it('3 秒后自动消失', () => {
    renderWithProvider()
    fireEvent.click(screen.getByText('触发'))
    expect(screen.getByText('操作成功')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.queryByText('操作成功')).toBeNull()
  })

  it('点击 toast 立即消失', () => {
    renderWithProvider()
    fireEvent.click(screen.getByText('触发'))
    fireEvent.click(screen.getByText('操作成功'))
    expect(screen.queryByText('操作成功')).toBeNull()
  })

  it('多 toast 并存且各自按自己的时长独立消失', () => {
    renderWithProvider()
    fireEvent.click(screen.getByText('触发'))
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    fireEvent.click(screen.getByText('触发'))
    expect(screen.getAllByText('操作成功')).toHaveLength(2)
    // 第一个到 3s 自动消失，第二个仅剩 1.5s
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(screen.getAllByText('操作成功')).toHaveLength(1)
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(screen.queryByText('操作成功')).toBeNull()
  })

  it('点击关闭后对应定时器被清理', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    renderWithProvider()
    fireEvent.click(screen.getByText('触发'))
    fireEvent.click(screen.getByText('操作成功'))
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  it('success 类型应用成功语义色', () => {
    renderWithProvider()
    fireEvent.click(screen.getByText('触发'))
    const toast = screen.getByText('操作成功')
    expect(toast.className).toContain('bg-success-bg')
    expect(toast.className).toContain('text-success')
  })

  it('Provider 卸载后定时器被清理（推进时间不报错、不残留更新）', () => {
    const { unmount } = renderWithProvider()
    fireEvent.click(screen.getByText('触发'))
    unmount()
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(3000)
      })
    }).not.toThrow()
  })
})
