import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 可复用的倒计时 hook。
 * start() 启动倒计时，countdown 自动递减到 0。
 * 组件卸载时自动清理定时器。
 */
export function useCountdown(defaultSeconds: number = 60) {
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const start = useCallback(
    (seconds?: number) => {
      const s = seconds ?? defaultSeconds
      setCountdown(s)
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    },
    [defaultSeconds]
  )

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  return { countdown, start, isActive: countdown > 0 }
}
