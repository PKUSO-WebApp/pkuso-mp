import { useMemo } from 'react'
import { useThemeContext } from '@/context/theme-context'
import { PLACEHOLDER_COLOR } from '@/lib/theme'

/** 返回适配当前主题的 placeholderStyle 字符串。
 *  色值取自 `PLACEHOLDER_COLOR`（= app.css 的 --color-text-muted，有测试守着）——
 *  原生 placeholder 吃不到 CSS 变量，只能以写死的值传入。 */
export function usePlaceholderStyle(): string {
  const { mode } = useThemeContext()
  return useMemo(() => `color: ${PLACEHOLDER_COLOR[mode]}`, [mode])
}
