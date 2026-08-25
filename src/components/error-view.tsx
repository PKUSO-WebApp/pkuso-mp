import type { CSSProperties } from 'react'
import Taro from '@tarojs/taro'
import { View, Text, Button } from '@tarojs/components'
import { useT } from '@/i18n'

interface ErrorViewProps {
  title?: string
  message: string
  stack?: string
}

export function ErrorView({ title, message, stack }: ErrorViewProps) {
  const { t } = useT()
  const resolvedTitle = title ?? t('common.error.defaultTitle')
  const full = stack ? `${message}\n\n${stack}` : message

  const handleCopy = () => {
    Taro.setClipboardData({ data: full })
      .then(() => Taro.showToast({ title: t('common.error.copySuccess'), icon: 'none' }))
      .catch(() => Taro.showToast({ title: t('common.error.copyFailed'), icon: 'none' }))
  }

  const container: CSSProperties = {
    padding: '48rpx 40rpx',
    boxSizing: 'border-box',
    minHeight: '100vh',
    backgroundColor: '#ffffff',
  }
  const icon: CSSProperties = {
    fontSize: '80rpx',
    textAlign: 'center',
    display: 'block',
    marginBottom: '24rpx',
  }
  const heading: CSSProperties = {
    fontSize: '36rpx',
    fontWeight: 600,
    textAlign: 'center',
    display: 'block',
    marginBottom: '24rpx',
    color: '#18181b',
  }
  const msg: CSSProperties = {
    fontSize: '28rpx',
    color: '#71717a',
    lineHeight: 1.6,
    display: 'block',
    marginBottom: '24rpx',
    wordBreak: 'break-all',
  }
  const stackStyle: CSSProperties = {
    fontSize: '22rpx',
    color: '#a1a1aa',
    lineHeight: 1.5,
    display: 'block',
    marginBottom: '32rpx',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    backgroundColor: '#f4f4f5',
    padding: '16rpx',
    borderRadius: '8rpx',
  }
  const hint: CSSProperties = {
    fontSize: '24rpx',
    color: '#a1a1aa',
    textAlign: 'center',
    display: 'block',
    marginTop: '24rpx',
    lineHeight: 1.6,
  }

  return (
    <View style={container}>
      <Text style={icon}>⚠️</Text>
      <Text style={heading}>{resolvedTitle}</Text>
      <Text style={msg}>{message}</Text>
      {stack ? <Text style={stackStyle}>{stack}</Text> : null}
      <Button onClick={handleCopy}>{t('common.error.copyButton')}</Button>
      <Text style={hint}>{t('common.error.hint')}</Text>
    </View>
  )
}
