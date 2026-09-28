import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 可复用的倒计时 hook（验证码重发冷却）。
 *
 * - `start(seconds?)`：启动倒计时（不传则用 defaultSeconds），自动递减到 0；
 *   重复调用会先清掉上一只表，不会叠加。
 * - `stop()`：停表并归零（验证成功 / 关闭弹窗 / 换账号等「不必再等」的场合）。
 * - 组件卸载自动清理定时器。
 *
 * 收敛背景：setup 与 profile 两个页面原本各自手写这套「state + countdownRef +
 * setInterval」，profile 里「重开弹窗时按 codeSentAt 续算剩余秒数」那段还整段抄了
 * 两遍。手写版每多一处出口就多一处 clearInterval 要记得写，漏一个就是一只停不下来
 * 的定时器（setup 原来靠一个专门的 useEffect 兜底，profile 也是）。
 */
export function useCountdown(defaultSeconds: number = 60) {
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const start = useCallback(
    (seconds?: number) => {
      clearTimer()
      setCountdown(seconds ?? defaultSeconds)
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearTimer()
            return 0
          }
          return prev - 1
        })
      }, 1000)
    },
    [clearTimer, defaultSeconds]
  )

  const stop = useCallback(() => {
    clearTimer()
    setCountdown(0)
  }, [clearTimer])

  // 卸载时清表（返回的正是 clearTimer 本身）
  useEffect(() => clearTimer, [clearTimer])

  return { countdown, start, stop, isActive: countdown > 0 }
}
