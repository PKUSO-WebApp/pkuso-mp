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
  // 词表由用例切换：注册页的入团时间曾经把「本地化文案」当值写库，只有 en 环境才暴露
  locale: 'zh-CN' as 'zh-CN' | 'en',
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
  const zhMod = await import('@/i18n/messages/zh-CN')
  const enMod = await import('@/i18n/messages/en')
  const dicts: Record<string, unknown> = { 'zh-CN': zhMod.zhCN, en: enMod.en }
  const get = (k: string, p?: Record<string, unknown>): string => {
    const val = k
      .split('.')
      .reduce<unknown>(
        (o, key) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[key] : undefined),
        dicts[mocks.locale]
      )
    let s = typeof val === 'string' ? val : k
    if (p)
      s = s.replace(/\{(\w+)\}/g, (_, key) => (p[key] !== undefined ? String(p[key]) : `{${key}}`))
    return s
  }
  return {
    useT: () => ({
      t: (k: string, p?: Record<string, unknown>) => get(k, p),
      locale: mocks.locale,
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

/** 同上，但界面处于英文环境（标签与占位符都取 en 词表） */
async function fillValidFormEn() {
  typeInto('Enter your real name', 'Lisa Chen')
  typeInto('name@example.com', 'Lisa@Example.COM')
  fireEvent.click(screen.getByText('Select section'))
  typeInto('e.g. School of Economics', 'School of Economics')
  fireEvent.click(screen.getByText('Year'))
  fireEvent.click(screen.getByText('Semester'))
  fireEvent.click(screen.getByText('Enrolled'))
  fireEvent.click(screen.getByText('I have read and agree to'))
}

beforeEach(() => {
  mocks.locale = 'zh-CN'
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

  it('英文环境提交：界面照旧显示 Spring，写库的是规范值「YYYY春/秋」', async () => {
    mocks.locale = 'en'
    render(<Register />)
    await waitFor(() => expect(screen.getByText('Submit')).toBeTruthy())
    await fillValidFormEn()

    // 显示侧仍是本地化文案——别为了写库把展示也改成「春」
    expect(screen.getByText('Spring')).toBeTruthy()

    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1))
    const [, opts] = mocks.invoke.mock.calls[0] as unknown as [
      string,
      { body: Record<string, unknown> },
    ]
    // 库里只接受「YYYY春/YYYY秋」：en 下若把 Spring 拼进去，会被 CHECK 约束拒掉、整次注册 500
    expect(opts.body.join_date).toBe(`${new Date().getFullYear()}春`)
  })

  it('提交失败后重试：重新取 wx.login 的 code，不复用上一次那个', async () => {
    // 微信 code 是一次性的：沿用同一个 code 重试会被 code2session 拒掉，
    // 用户看到的还是那句「提交失败」——第一次修的就是这个（服务端 401）
    mocks.login
      .mockResolvedValueOnce({ code: 'WXCODE-1' })
      .mockResolvedValueOnce({ code: 'WXCODE-2' })
    mocks.invoke
      .mockResolvedValueOnce({ data: { error: 'profile update failed' }, error: null })
      .mockResolvedValueOnce({ data: { access_token: 'at', refresh_token: 'rt' }, error: null })

    render(<Register />)
    await waitFor(() => expect(screen.getByText('提交')).toBeTruthy())
    await fillValidForm()

    fireEvent.click(screen.getByText('提交'))
    await waitFor(() => expect(screen.getByText('提交失败，请稍后重试')).toBeTruthy())

    fireEvent.click(screen.getByText('提交'))
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2))

    const codes = mocks.invoke.mock.calls.map(
      (call) => (call as unknown as [string, { body: { code: string } }])[1].body.code
    )
    expect(codes).toEqual(['WXCODE-1', 'WXCODE-2'])
  })

  it('wx.login 取不到 code：提示微信授权失败，不发请求', async () => {
    mocks.login.mockRejectedValueOnce(new Error('login:fail'))
    render(<Register />)
    await waitFor(() => expect(screen.getByText('提交')).toBeTruthy())
    await fillValidForm()
    fireEvent.click(screen.getByText('提交'))

    await waitFor(() => expect(screen.getByText('微信授权失败，请重试')).toBeTruthy())
    expect(mocks.invoke).not.toHaveBeenCalled()
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
