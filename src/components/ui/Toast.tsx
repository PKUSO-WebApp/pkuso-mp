import { View } from '@tarojs/components'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

type ToastType = 'success' | 'error' | 'info'

type ToastItem = {
  id: number
  message: string
  type: ToastType
}

type ToastFn = (message: string, type?: ToastType) => void

const ToastCtx = createContext<ToastFn>(() => {})

let nextId = 0

const TOAST_DURATION = 3000

const typeClasses: Record<ToastType, string> = {
  success: 'bg-success-bg text-success',
  error: 'bg-danger-bg text-danger',
  info: 'bg-muted text-text',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  // 记录「toast id → 定时器句柄」，供点击关闭/卸载时精确清理，避免残留回调空跑 setState
  const timersRef = useRef<{ id: number; timer: ReturnType<typeof setTimeout> }[]>([])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      // 组件卸载：清掉所有未触发的定时器，避免回调触发已卸载组件更新
      timers.forEach(({ timer }) => clearTimeout(timer))
    }
  }, [])

  const removeTimer = useCallback((id: number) => {
    // 原地 splice 保持数组引用不变，卸载清理闭包始终能看到剩余句柄
    const index = timersRef.current.findIndex((entry) => entry.id === id)
    if (index !== -1) {
      timersRef.current.splice(index, 1)
    }
  }, [])

  const dismiss = useCallback(
    (id: number) => {
      // 点击关闭：先清理对应定时器（防止 3s 后残留回调空跑 filter），再移除 toast
      const entry = timersRef.current.find((e) => e.id === id)
      if (entry) {
        clearTimeout(entry.timer)
        removeTimer(id)
      }
      setToasts((prev) => prev.filter((x) => x.id !== id))
    },
    [removeTimer]
  )

  const toast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = nextId++
      setToasts((prev) => [...prev, { id, message, type }])
      const timer = setTimeout(() => {
        // 自动消失：定时器已触发，从句柄列表移除自身（无需 clearTimeout）
        removeTimer(id)
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, TOAST_DURATION)
      timersRef.current.push({ id, timer })
    },
    [removeTimer]
  )

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      {/* 居中不依赖 translate（旧安卓 X5 兼容）：容器撑满左右、列向 items-center 实现水平居中；
          间距用子项 mb-2（WXSS 兄弟选择器在组件隔离下不可靠） */}
      <View className='fixed left-0 right-0 top-4 z-50 flex flex-col items-center'>
        {toasts.map((t) => (
          <View
            key={t.id}
            className={`mb-2 rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg ${typeClasses[t.type]}`}
            onClick={() => dismiss(t.id)}
          >
            {t.message}
          </View>
        ))}
      </View>
    </ToastCtx.Provider>
  )
}

export function useToast(): ToastFn {
  return useContext(ToastCtx)
}
