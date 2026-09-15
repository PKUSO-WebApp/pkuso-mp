import { useMemo } from 'react'
import { useThemeContext } from '@/context/theme-context'

/** 返回适配当前主题的 placeholderStyle 字符串
 * 亮色模式: #71717a (gray-500) - 对应 --color-text-muted
 * 暗色模式: #b5b5be (gray-400) - 对应 --color-text-muted
 * 也可用统一中间色 #9ca3af (gray-400) 双模式通用
 */
export function usePlaceholderStyle(): string {
  const { mode } = useThemeContext()
  return useMemo(() => {
    const color = mode === 'dark' ? '#b5b5be' : '#71717a'
    return `color: ${color}`
  }, [mode])
}