import Taro from '@tarojs/taro'

/**
 * 「现在有没有网」的**同步**答案 + 网络恢复通知。
 *
 * 为什么要自己记一份：`getNetworkType` 只有异步版，而预热泵在 `run()` 入口要一个同步判据
 * （为了它把整个循环改成异步等待不值当——见 prefetch-pump 的 `isOnline`）。
 *
 * **初值乐观取 true**：探针说错的代价只是「泵照旧跑起来、请求失败、按既有『失败即跳过』
 * 处理」，与从前完全一致；反过来（无网时误判成有网也一样）不会比现状更糟——所以这里
 * 宁可乐观，不要因为一次探测不确定就把预下载永久停掉。
 *
 * ⚠️ `onNetworkStatusChange` 在开发者工具里模拟离线**未必触发**（模拟的是请求失败，
 * 不是网卡状态）——真机才是判据。见 lib/error-report.ts 里 netLastKnown 的同名告诫。
 */
let online = true
const listeners = new Set<() => void>()
let watching = false

/** 同步判据（给泵用）。语义是「最近一次已知」的状态，不是失败那一刻的 */
export function isOnline(): boolean {
  return online
}

/**
 * 订阅「网络恢复了」（返回取消订阅）。只在第一个订阅者出现时挂上小程序监听——
 * 它是**进程级**的，不该每进一次阅读器挂一个。
 */
export function onReconnect(fn: () => void): () => void {
  listeners.add(fn)
  if (!watching) {
    watching = true
    try {
      // 初值修正：进阅读器时先问一次（异步，回来时泵可能已经跑起来了——那也没关系，
      // 这条路只是让「一进来就没网」的判断更早生效）
      Taro.getNetworkType?.({
        success: (res) => {
          online = res.networkType !== 'none'
        },
      })
      Taro.onNetworkStatusChange?.((res) => {
        const was = online
        online = Boolean(res.isConnected)
        if (online && !was) listeners.forEach((f) => f())
      })
    } catch {
      /* 拿不到就保持乐观的 true */
    }
  }
  return () => {
    listeners.delete(fn)
  }
}
