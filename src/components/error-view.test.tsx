// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ErrorView } from './error-view'

const setClipboardData = vi.fn()
const showToast = vi.fn()
const reportClientError = vi.fn()

vi.mock('@tarojs/taro', () => ({
  default: {
    setClipboardData: (o: unknown) => setClipboardData(o),
    showToast: (o: unknown) => showToast(o),
  },
}))

vi.mock('@tarojs/components', () => {
  const create = (tag: string) => (props: any) => {
    const { hoverClass, ...rest } = props
    return React.createElement(tag, rest)
  }
  return { View: create('div'), Text: create('span'), Button: create('button') }
})

vi.mock('@/context/theme-context', () => ({ useThemeClass: () => '' }))

// ⚠️ 这里**不能**用 importOriginal：error-report 会连带拉起 supabase 客户端，
// 而那要求 .env 里的配置（单测环境没有）⇒ 整个文件会在 mock 阶段就炸掉。
// describeError 按真实实现照抄一份（Taro 的失败 reject 的是 `{ errMsg }` 对象）。
vi.mock('@/lib/error-report', () => ({
  reportClientError: (i: unknown) => reportClientError(i),
  describeError: (err: unknown) => {
    if (err instanceof Error) return err.message
    const e = err as { errMsg?: unknown; message?: unknown } | null
    const text = e?.errMsg ?? e?.message
    return typeof text === 'string' && text ? text : String(err)
  },
}))

vi.mock('@/i18n', () => ({
  useT: () => ({
    t: (k: string, p?: Record<string, unknown>) => {
      const dict: Record<string, string> = {
        'common.error.defaultTitle': '出错了',
        'common.error.copyButton': '复制错误信息',
        'common.error.copySuccess': '已复制错误信息',
        'common.error.copyFailed': '复制失败',
        'common.error.copyTruncated': '已复制（内容过长，已截断）',
      }
      let s = dict[k] ?? k
      if (p) s = s.replace(/\{(\w+)\}/g, (_, key) => String(p[key] ?? ''))
      return s
    },
  }),
}))

const LONG_STACK = 'x'.repeat(3000)

describe('ErrorView 的复制', () => {
  beforeEach(() => {
    setClipboardData.mockReset()
    showToast.mockReset()
    reportClientError.mockReset()
  })
  afterEach(() => cleanup())

  it('全长能复制时不截断，也不上报', async () => {
    setClipboardData.mockResolvedValue({})
    render(<ErrorView message='崩了' stack={LONG_STACK} />)
    fireEvent.click(screen.getByRole('button', { name: '复制错误信息' }))
    await vi.waitFor(() => expect(setClipboardData).toHaveBeenCalledTimes(1))
    expect(setClipboardData.mock.calls[0][0].data).toContain(LONG_STACK)
    expect(reportClientError).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith({ title: '已复制错误信息', icon: 'none' })
  })

  it('⚠️ 全长失败 ⇒ 自动改用短文本**再试一次**，并把「是长度问题」上报', async () => {
    // 真机上报的就是这一条：长内容被剪贴板拒掉（各机型上限 300B~10KB 不等）
    setClipboardData
      .mockRejectedValueOnce({ errMsg: 'setClipboardData:fail' })
      .mockResolvedValueOnce({})
    render(<ErrorView message='崩了' stack={LONG_STACK} />)
    fireEvent.click(screen.getByRole('button', { name: '复制错误信息' }))
    await vi.waitFor(() => expect(setClipboardData).toHaveBeenCalledTimes(2))
    const second = setClipboardData.mock.calls[1][0].data as string
    expect(second.length).toBeLessThan(500) // 明显短于全长
    expect(second).toContain('崩了') // 仍然是可用的信息，不是空串
    expect(reportClientError.mock.calls[0][0].event).toBe('clipboard_copy_truncated')
    expect(showToast).toHaveBeenCalledWith({ title: '已复制（内容过长，已截断）', icon: 'none' })
  })

  it('两次都失败 ⇒ 上报两条 errMsg（现场要能分辨「不是长度问题」）', async () => {
    setClipboardData.mockRejectedValue({ errMsg: 'setClipboardData:fail api scope is not declared' })
    render(<ErrorView message='崩了' stack={LONG_STACK} />)
    fireEvent.click(screen.getByRole('button', { name: '复制错误信息' }))
    await vi.waitFor(() => expect(reportClientError).toHaveBeenCalled())
    const report = reportClientError.mock.calls[0][0]
    expect(report.event).toBe('clipboard_copy_failed')
    expect(report.message).toContain('api scope is not declared')
    expect(showToast).toHaveBeenCalledWith({ title: '复制失败', icon: 'none' })
  })

  it('message 为空时也复制一段非空文本（空串会被 API 直接拒）', async () => {
    setClipboardData.mockResolvedValue({})
    render(<ErrorView message='' />)
    fireEvent.click(screen.getByRole('button', { name: '复制错误信息' }))
    await vi.waitFor(() => expect(setClipboardData).toHaveBeenCalled())
    expect(setClipboardData.mock.calls[0][0].data).toBe('出错了')
  })
})
