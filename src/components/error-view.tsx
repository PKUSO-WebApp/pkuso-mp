import type { CSSProperties } from 'react'
import Taro from '@tarojs/taro'
import { View, Text, Button } from '@tarojs/components'

interface ErrorViewProps {
  title?: string
  message: string
  stack?: string
}

export function ErrorView({ title = '页面出错了', message, stack }: ErrorViewProps) {
  const full = stack ? `${message}\n\n${stack}` : message

  const handleCopy = () => {
    Taro.setClipboardData({ data: full })
      .then(() => Taro.showToast({ title: '已复制错误信息', icon: 'none' }))
      .catch(() => Taro.showToast({ title: '复制失败', icon: 'none' }))
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
      <Text style={heading}>{title}</Text>
      <Text style={msg}>{message}</Text>
      {stack ? <Text style={stackStyle}>{stack}</Text> : null}
      <Button onClick={handleCopy}>复制错误信息</Button>
      <Text style={hint}>请把复制的信息发送给乐团管理员，以便尽快修复问题。</Text>
    </View>
  )
}
