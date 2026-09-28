import { beforeEach, describe, expect, it, vi } from 'vitest'

const taroMock = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  switchTab: vi.fn(),
  showToast: vi.fn(),
}))
const reportClientError = vi.hoisted(() => vi.fn())

vi.mock('@tarojs/taro', () => ({ default: taroMock }))
// error-report 会 import supabase，而后者在缺环境变量时**模块加载即抛**——这里替掉
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
// 只替换 reportClientError，保留 describeError 的真实实现：isNavigationError 靠它取 errMsg
vi.mock('@/lib/error-report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/error-report')>()),
  reportClientError,
}))

describe('navigate', () => {
  beforeEach(() => {
    taroMock.navigateTo.mockReset()
    taroMock.switchTab.mockReset()
    taroMock.showToast.mockReset().mockResolvedValue(undefined)
    reportClientError.mockReset()
  })

  it('认得出跳转失败——判据落在 errMsg 上，因为 reject 的不是 Error 实例', async () => {
    const { isNavigationError } = await import('@/lib/navigate')
    // Taro 的跳转失败 reject 的是 `{ errMsg: '<api>:fail …' }` 对象
    expect(isNavigationError({ errMsg: 'navigateTo:fail timeout' })).toBe(true)
    expect(isNavigationError({ errMsg: 'switchTab:fail timeout' })).toBe(true)
    expect(isNavigationError({ errMsg: 'reLaunch:fail' })).toBe(true)
    expect(isNavigationError({ errMsg: 'redirectTo:fail' })).toBe(true)

    // ⚠️ 这条比上面那些重要：误判成「跳转失败」会让真正的崩溃只弹一句 toast、
    // 丢掉整页错误屏（那是用户唯一能复制错误信息的地方）。所以别的错误必须为 false。
    expect(isNavigationError({ errMsg: 'request:fail errcode:-101' })).toBe(false)
    expect(isNavigationError(new Error('boom'))).toBe(false)
    expect(isNavigationError({ errMsg: 'navigateTo:ok' })).toBe(false)
    expect(isNavigationError(undefined)).toBe(false)
  })

  it('safeNavigate：成功返回 true，且不打扰用户', async () => {
    const { safeNavigate } = await import('@/lib/navigate')
    taroMock.switchTab.mockResolvedValue({})

    await expect(safeNavigate('switchTab', '/pages/index/index')).resolves.toBe(true)

    expect(taroMock.switchTab).toHaveBeenCalledWith({ url: '/pages/index/index' })
    expect(reportClientError).not.toHaveBeenCalled()
    expect(taroMock.showToast).not.toHaveBeenCalled()
  })

  it('safeNavigate：失败**不抛**，改成上报 + 轻提示 + 返回 false', async () => {
    const { safeNavigate } = await import('@/lib/navigate')
    taroMock.navigateTo.mockRejectedValue({ errMsg: 'navigateTo:fail timeout' })

    // 「不抛」是这条的全部意义：抛出去会被登录链路当成登录失败上报
    // （会话其实已经建立好了），用户看到「微信登录失败」而事实只是没跳过去
    await expect(safeNavigate('navigateTo', '/pages/x/index')).resolves.toBe(false)

    expect(reportClientError).toHaveBeenCalledTimes(1)
    expect(reportClientError.mock.calls[0][0]).toMatchObject({
      event: 'navigate_failed',
      message: 'navigateTo:fail timeout',
      detail: { api: 'navigateTo', url: '/pages/x/index' },
    })
    expect(taroMock.showToast).toHaveBeenCalledTimes(1)
  })
})
