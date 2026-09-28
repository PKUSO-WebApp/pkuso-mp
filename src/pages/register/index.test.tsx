// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Register from './index'

/**
 * 注册页：表单校验链 + 一次后端调用（register-with-wechat）+ 成功后建会话并路由。
 * 校验链是「第一个不合格就 return」，所以用例按顺序补字段，专门压「拦在哪一步」。
 */

const route: { params: Record<string, string> } = { params: {} }

const mocks = vi.hoisted(() => ({
  login: vi.fn(async () => ({ code: 'WXCODE-1' })),
  showToast: vi.fn(),
  navigateTo: vi.fn(),
  reLaunch: vi.fn(),
  invoke: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({
    data: { access_token: 'at', refresh_token: 'rt' },
    error: null,
  })),
  setSession: vi.fn(async () => ({ error: null })),
  getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
  routeAfterLogin: vi.fn(async () => undefined),
}))

vi.mock('@tarojs/components', () => {
  const create = (tag: string) => (props: Record<string, unknown>) => {
    const { hoverClass, catchMove, ...rest } = props
    return React.createElement(tag, rest)
  }
  const toTaroInput = (tag: string) => (props: Record<string, unknown>) => {
    const { onInput, ...rest } = props as { onInput?: (e: unknown) => void }
    return React.createElement(tag, {
      ...rest,
      onChange: (e: { target?: { value?: string } }) =>
        onInput?.({ detail: { value: e?.target?.value } }),
    })
  }
  // Picker 在小程序里弹原生选择器，jsdom 里没有——垫片把「点击」翻译成「选了第 0 项」。
  // range/value/mode 要显式摘掉（否则 React 会往 div 上塞非法属性），签名里就得声明它们
  const Picker = (props: Record<string, unknown>) => {
    const {
      onChange,
      range: _range,
      value: _value,
      mode: _mode,
      children,
      ...rest
    } = props as {
      onChange?: (e: unknown) => void
      range?: unknown
      value?: unknown
      mode?: unknown
      children?: React.ReactNode
    }
    return React.createElement(
      'div',
      { ...rest, onClick: () => onChange?.({ detail: { value: 0 } }) },
      children
    )
  }
  return {
    View: create('div'),
    Text: create('span'),
    Button: create('button'),
    Input: toTaroInput('input'),
    Textarea: toTaroInput('textarea'),
    Image: (props: Record<string, unknown>) => React.createElement('img', props),
    Picker,
  }
})

vi.mock('@tarojs/taro', () => ({
  default: {
    getCurrentInstance: () => ({ router: route }),
    login: mocks.login,
    showToast: mocks.showToast,
    navigateTo: mocks.navigateTo,
    reLaunch: mocks.reLaunch,
  },
  useShareAppMessage: vi.fn(),
}))

vi.mock('@/context/theme-context', () => ({ useThemeClass: () => '' }))
// ready 必须为 true：页面在 !ready 时渲染「加载中」并早退，表单根本不会出现
vi.mock('@/context/user-context', () => ({ useUser: () => ({ ready: true, user: null }) }))
vi.mock('@/hooks/usePlaceholderStyle', () => ({ usePlaceholderStyle: () => 'color: #71717a' }))
vi.mock('@/lib/post-auth-route', () => ({ routeAfterLogin: mocks.routeAfterLogin }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: mocks.getUser, setSession: mocks.setSession },
    functions: { invoke: mocks.invoke },
  },
}))
vi.mock('@/i18n', async () => {
  const mod = await import('@/i18n/messages/zh-CN')
  const dict = mod.zhCN as Record<string, unknown>
  const get = (k: string, p?: Record<string, unknown>): string => {
    const val = k
      .split('.')
      .reduce<unknown>(
        (o, key) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[key] : undefined),
        dict
      )
    let s = typeof val === 'string' ? val : k
    if (p)
      s = s.replace(/\{(\w+)\}/g, (_, key) => (p[key] !== undefined ? String(p[key]) : `{${key}}`))
    return s
  }
  return {
    useT: () => ({
      t: (k: string, p?: Record<string, unknown>) => get(k, p),
      locale: 'zh-CN',
      setLocale: vi.fn(),
    }),
    useNavTitle: vi.fn(),
  }
})

function typeInto(placeholder: string, value: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } })
}

/** 把表单填到「能通过校验」的程度（校验链顺序：同意 → 姓名 → 邮箱 → 声部 → 学院 → 入团时间 → 在团 → 微信 code） */
async function fillValidForm() {
  typeInto('请输入真实姓名', '张三')
  // 故意用大小写混合：提交前会被 toLowerCase，这样「忘了小写化」才验得出来
  typeInto('name@example.com', 'ZhangSan@Example.COM')
  fireEvent.click(screen.getByText('请选择声部')) // Picker 垫片：点了就选第 0 项
  typeInto('例如：经济学院', '经济学院')
  fireEvent.click(screen.getByText('年份'))
  fireEvent.click(screen.getByText('学期'))
  fireEvent.click(screen.getByText('在团'))
  fireEvent.click(screen.getByText('我已阅读并同意'))
}

beforeEach(() => {
  route.params = {}
  mocks.invoke.mockResolvedValue({ data: { access_token: 'at', refresh_token: 'rt' }, error: null })
  mocks.setSession.mockResolvedValue({ error: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('注册页', () => {
  it('从路由参数预填邮箱（登录页跳过来时带 email）', async () => {
    route.params = { email: encodeURIComponent('prefilled@example.com') }
    render(<Register />)

    await waitFor(() =>
      expect((screen.getByPlaceholderText('name@example.com') as HTMLInputElement).value).toBe(
        'prefilled@example.com'
      )
    )
  })

  it('未同意协议：只弹提示，不发请求', async () => {
    render(<Register />)
    await waitFor(() => expect(screen.getByText('提交')).toBeTruthy())
    fireEvent.click(screen.getByText('提交'))

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith({
        title: '请先同意用户协议',
        icon: 'none',
      })
    )
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('同意协议但缺字段：拦在必填项上，不发请求', async () => {
    render(<Register />)
    await waitFor(() => expect(screen.getByText('提交')).toBeTruthy())
    fireEvent.click(screen.getByText('我已阅读并同意'))
    fireEvent.click(screen.getByText('提交'))

    await waitFor(() => expect(screen.getByText('请填写所有必填项')).toBeTruthy())
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('填全后提交：载荷含微信 code、小写邮箱、拼接的入团时间', async () => {
    render(<Register />)
    await fillValidForm()
    await waitFor(() => expect(screen.getByText('提交')).toBeTruthy())
    fireEvent.click(screen.getByText('提交'))

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1))
    const [fnName, opts] = mocks.invoke.mock.calls[0] as unknown as [
      string,
      { body: Record<string, unknown> },
    ]
    expect(fnName).toBe('register-with-wechat')
    expect(opts.body).toMatchObject({
      code: 'WXCODE-1',
      full_name: '张三',
      email: 'zhangsan@example.com', // 提交前 toLowerCase
      is_in_orchestra: true,
    })
    // 声部取自 INSTRUMENT_ORDER 第 0 项、入团时间是「年份 + 学期」拼出来的
    expect(typeof opts.body.instrument).toBe('string')
    expect(String(opts.body.join_date)).toMatch(/^\d{4}(春|秋)$/)
  })

  it('后端说微信已绑定：显示对应文案，不建会话', async () => {
    mocks.invoke.mockResolvedValue({ data: { error: 'wechat_already_bound' }, error: null })
    render(<Register />)
    await fillValidForm()
    await waitFor(() => expect(screen.getByText('提交')).toBeTruthy())
    fireEvent.click(screen.getByText('提交'))

    await waitFor(() => expect(screen.getByText('该微信已绑定其他账号')).toBeTruthy())
    expect(mocks.setSession).not.toHaveBeenCalled()
    expect(mocks.routeAfterLogin).not.toHaveBeenCalled()
  })

  it('成功后建会话并按角色路由', async () => {
    render(<Register />)
    await fillValidForm()
    await waitFor(() => expect(screen.getByText('提交')).toBeTruthy())
    fireEvent.click(screen.getByText('提交'))

    await waitFor(() =>
      expect(mocks.setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' })
    )
    await waitFor(() => expect(mocks.routeAfterLogin).toHaveBeenCalled())
  })
})
