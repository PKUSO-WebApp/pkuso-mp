import Taro from '@tarojs/taro'
import { translateCurrent } from '@/i18n/core'
import { describeError, reportClientError } from './error-report'

/** 会因为「目标页打不开」而失败的那几个跳转。navigateBack 不取 URL、语义也不同，不在内 */
export type NavApi = 'navigateTo' | 'switchTab' | 'redirectTo' | 'reLaunch'

const NAV_FAIL_RE = /(navigateTo|switchTab|redirectTo|reLaunch):fail/

/**
 * 这个错误是不是「跳转失败」。
 *
 * 单独认它的意义在于：**跳转失败和「页面崩了」是两回事**。失败时用户还停在原来那一屏、
 * 应用本身也是好的（断网时 navigateTo / switchTab 会超时失败，见 issue #7）。
 * 把这种情况丢进整页错误屏比失败本身更糟——用户本来只是想切个 tab，
 * 结果被送到一个只有「复制错误信息」的错误页上，还得自己找路回去。
 *
 * 判据只能落在 errMsg 上：Taro 的跳转失败 reject 的是 `{ errMsg: 'navigateTo:fail …' }`
 * 对象、不是 Error 实例（与网络失败同款，见 lib/supabase.ts 里同样的处理）。
 */
export function isNavigationError(err: unknown): boolean {
  return NAV_FAIL_RE.test(describeError(err))
}

/** 跳转失败时的统一提示。导出是因为 app.ts 的全局兜底要用同一句话，避免两处文案漂移。 */
export function showNavigateFailedToast(): void {
  Taro.showToast({ title: translateCurrent('common.errors.navigateFailed'), icon: 'none' }).catch(
    () => {
      // 提示弹不出来不影响业务，绝不反过来抛
    }
  )
}

function callNavigate(api: NavApi, url: string): Promise<unknown> {
  switch (api) {
    case 'navigateTo':
      return Taro.navigateTo({ url })
    case 'switchTab':
      return Taro.switchTab({ url })
    case 'redirectTo':
      return Taro.redirectTo({ url })
    case 'reLaunch':
      return Taro.reLaunch({ url })
  }
}

/**
 * 带兜底的跳转：失败时上报 + 轻提示，并**返回是否跳过去了**，而不是把 rejection 抛给调用方。
 *
 * 为什么不让它抛：调用方几乎都假设「跳转一定成功」。典型是登录成功后的 `routeAfterLogin`
 * ——那一下 reLaunch 失败时，异常会一路冒到登录的 catch 里被当成**登录失败**上报
 * （会话其实已经建立好了）；用户看到「微信登录失败」，而事实只是没跳过去。
 * 返回布尔值，调用方才能把这两件事分开。
 *
 * 注意它**不重试**：跳转失败的主因是网络抖动，而重试的价值取决于调用方——
 * 登录链路该让用户重按一次，切 tab 该等网络恢复（见 app.ts 的 onNetworkStatusChange）。
 * 由调用方按自己的语义决定，比在这里统一重试更准。
 */
export async function safeNavigate(api: NavApi, url: string): Promise<boolean> {
  try {
    await callNavigate(api, url)
    return true
  } catch (err) {
    reportClientError({
      event: 'navigate_failed',
      message: describeError(err),
      detail: { api, url },
    })
    showNavigateFailedToast()
    return false
  }
}
