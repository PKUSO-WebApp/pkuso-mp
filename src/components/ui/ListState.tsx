import type { ReactNode } from 'react'
import { View, Text } from '@tarojs/components'
import { useT } from '@/i18n'

type ListStateProps = {
  loading: boolean
  /** 静默刷新语义（P0-2）：true 时仅内容为空才显示 loading；默认 true */
  loadingOnlyWhenEmpty?: boolean
  /** 内容是否为空（决定 loading 门控与空态分支）；默认 false */
  isEmpty?: boolean
  /** 错误文案（已归一化）；非空时渲染错误分支 */
  error?: string | null
  /** 空态文案（isEmpty 恒 false 的门控型用法可省略） */
  emptyText?: string
  /** 提供则错误态显示「重试」按钮 */
  onRetry?: () => void
  children: ReactNode
}

/**
 * 列表三态块（P2-2 合一）：loading / error(+可选重试) / empty / content。
 * 原各页手写三分支的样式与留白不一（py-8/10/12、Card 包裹与否），此处统一；
 * members 页因双空态语义保留自写分支，post-detail/post-edit 为页面级非列表不适用。
 */
export function ListState({
  loading,
  loadingOnlyWhenEmpty = true,
  isEmpty = false,
  error = null,
  emptyText,
  onRetry,
  children,
}: ListStateProps) {
  const { t } = useT()
  if (loading && (!loadingOnlyWhenEmpty || isEmpty)) {
    return (
      <Text className='block py-12 text-center text-xs text-text-muted'>
        {t('common.actions.loading')}
      </Text>
    )
  }
  if (error) {
    return (
      <View>
        <Text className='block px-3 py-2 text-center text-sm text-danger'>{error}</Text>
        {onRetry && (
          <View className='mt-3 flex justify-center' onClick={onRetry}>
            <Text className='rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-text'>
              {t('common.actions.retry')}
            </Text>
          </View>
        )}
      </View>
    )
  }
  if (isEmpty) {
    return <Text className='block py-12 text-center text-xs text-text-muted'>{emptyText}</Text>
  }
  return <>{children}</>
}
