import { useEffect, useState } from 'react'
import { View, Text } from '@tarojs/components'
import { translate, type Dict } from '@/i18n/core'
import { loaders } from '@/i18n'
import { LOCALES, type Locale } from '@/i18n/storage'
import { zhCN } from '@/i18n/messages/zh-CN'

const CYCLE_MS = 5000
const BLUR_MS = 250

/**
 * 语言设置入口的装饰性预览：每 5 秒在已实现的各语言间模糊切换，
 * 展示该入口在每门语言下的文案（如「语言设置」↔「Language Setting」）。
 * 列表式循环（LOCALES）：新增语言只需往 LOCALES / loaders 登记即自动纳入。
 */
export function LanguagePreview({ className }: { className?: string }) {
  const [dicts, setDicts] = useState<Partial<Record<Locale, Dict>>>({ 'zh-CN': zhCN as Dict })
  const [index, setIndex] = useState(0)
  const [blurring, setBlurring] = useState(false)

  // 预载各语言词典（zh-CN 静态，其余按需动态 import），供预览按语言取词
  useEffect(() => {
    let active = true
    void Promise.all(LOCALES.map((l) => loaders[l]().then((m) => [l, m.default] as const)))
      .then((entries) => {
        if (active) setDicts(Object.fromEntries(entries))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  // 每 CYCLE_MS 触发一次模糊切换
  useEffect(() => {
    let active = true
    let blurTimer: ReturnType<typeof setTimeout> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const cycle = () => {
      if (!active) return
      setBlurring(true)
      blurTimer = setTimeout(() => {
        if (!active) return
        setIndex((i) => (i + 1) % LOCALES.length)
        setBlurring(false)
        timer = setTimeout(cycle, CYCLE_MS)
      }, BLUR_MS)
    }
    timer = setTimeout(cycle, CYCLE_MS)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
      if (blurTimer) clearTimeout(blurTimer)
    }
  }, [])

  const dict = dicts[LOCALES[index]] ?? (zhCN as Dict)
  const label = translate(dict, 'profile.settings.language')

  return (
    <View
      style={{
        filter: blurring ? 'blur(3px)' : 'blur(0px)',
        opacity: blurring ? 0.4 : 1,
        transition: 'filter 0.25s ease, opacity 0.25s ease',
      }}
    >
      <Text className={className}>{label}</Text>
    </View>
  )
}
