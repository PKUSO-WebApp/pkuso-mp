import Taro from '@tarojs/taro'
import { View, Text, Button } from '@tarojs/components'
import { useThemeClass } from '@/context/theme-context'
import { useT } from '@/i18n'
import { describeError, reportClientError } from '@/lib/error-report'

interface ErrorViewProps {
  title?: string
  message: string
  stack?: string
}

/**
 * 复制失败后改用的短文本长度。
 *
 * 各机型/系统对剪贴板长度的容忍度差别很大（社区实测从约 300 字节到 10KB 都有），
 * 而这里要复制的正是 message + **整段 stack** —— 很容易踩到上限。所以：
 * 全长先试一次，失败再用这一段短的**再试一次**，两次结果都上报。
 * 用户因此总能拿到可用的复制，而「到底是不是长度问题」在上报里当场可判读。
 */
const SHORT_COPY_CHARS = 400

export function ErrorView({ title, message, stack }: ErrorViewProps) {
  const { t } = useT()
  const darkClass = useThemeClass()
  const resolvedTitle = title ?? t('common.error.defaultTitle')
  const full = stack ? `${message}\n\n${stack}` : message

  const handleCopy = async () => {
    // 空串会被 setClipboardData 直接拒掉（parameter.data should be String）
    const text = full || resolvedTitle
    const attempts = [text, text.slice(0, SHORT_COPY_CHARS)]
    const errs: string[] = []
    for (let i = 0; i < attempts.length; i += 1) {
      try {
        await Taro.setClipboardData({ data: attempts[i] })
        if (i > 0) {
          reportClientError({
            event: 'clipboard_copy_truncated',
            message: errs.join(' | '),
            detail: { chars: text.length, short: SHORT_COPY_CHARS },
          })
          void Taro.showToast({ title: t('common.error.copyTruncated'), icon: 'none' })
        } else {
          void Taro.showToast({ title: t('common.error.copySuccess'), icon: 'none' })
        }
        return
      } catch (err) {
        errs.push(describeError(err))
      }
    }
    // 短文本也失败 ⇒ 不是长度问题（隐私协议未声明剪贴板、系统策略拦截、基础库过低…），
    // 上报里带着每一条 errMsg —— 否则现场只剩一句「复制失败」，没有任何可查的线索
    reportClientError({
      event: 'clipboard_copy_failed',
      message: errs.join(' | '),
      detail: { chars: text.length },
    })
    void Taro.showToast({ title: t('common.error.copyFailed'), icon: 'none' })
  }

  return (
    <View className={`${darkClass} min-h-screen bg-page-bg px-10 py-24`}>
      <Text className='mb-3 block text-center text-[40px] leading-none'>⚠️</Text>
      <Text className='mb-3 block text-center text-lg font-semibold text-text'>
        {resolvedTitle}
      </Text>
      <Text className='mb-3 block break-all text-sm leading-relaxed text-text-muted'>
        {message}
      </Text>
      {stack ? (
        <Text className='mb-4 block whitespace-pre-wrap break-all rounded-lg bg-muted p-2 text-xs leading-normal text-text-muted'>
          {stack}
        </Text>
      ) : null}
      <Button onClick={handleCopy}>{t('common.error.copyButton')}</Button>
      <Text className='mt-3 block text-center text-xs leading-relaxed text-text-subtle'>
        {t('common.error.hint')}
      </Text>
    </View>
  )
}
